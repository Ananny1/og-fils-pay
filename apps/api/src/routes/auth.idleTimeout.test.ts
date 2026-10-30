/**
 * SEC-2: a logged-in session also dies after a stretch with no requests
 * (merchant 60 min, admin 30 min by default), not only at its fixed 12 h / 8 h
 * expiry. Use moves last_seen_at forward, but at most once a minute, so a busy
 * dashboard is not one UPDATE per request. Logout revokes the row server-side.
 * Real migrated Postgres (DATABASE_URL).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../auth/passwords.js";
import { sha256Hex } from "../lib/crypto.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("auth.idleTimeout.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const kycUploadDir = mkdtempSync(join(tmpdir(), "filspay-kyc-test-"));
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  KYC_UPLOAD_DIR: kycUploadDir,
  OTP_DEV_EXPOSE: "true",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const app = buildApp(config, pool);
const PASSWORD = "idle-test-password-1!";

test.after(async () => {
  await app.close();
  await pool.end();
  await rm(kycUploadDir, { recursive: true, force: true });
});

function cookieOf(header: string | string[] | undefined): string {
  return (Array.isArray(header) ? header[0] : header)!.split(";")[0]!;
}

async function merchantLogin() {
  const email = `idle-${randomUUID()}@example.test`;
  const signup = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `Idle ${randomUUID().slice(0, 8)}`,
        registrationNumber: `RC-${randomUUID().slice(0, 8)}`,
        businessType: "llc",
        contactEmail: `contact-${randomUUID()}@example.test`,
        contactPhone: "+97300000000",
        addressLine1: "1 Test Street",
        city: "Manama",
      },
      owner: { email, password: PASSWORD },
    },
  });
  assert.equal(signup.statusCode, 201, signup.body);
  const merchantId = (signup.json() as { merchantId: string }).merchantId;
  return app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password: PASSWORD } });
}

async function adminLogin() {
  const email = `idle-${randomUUID()}@admin.test`;
  await pool.query(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'Idle', 'support')`,
    [email, await hashPassword(PASSWORD, config)],
  );
  return app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password: PASSWORD } });
}

const sides = [
  {
    name: "merchant",
    table: "sessions",
    login: merchantLogin,
    verify: "/v1/auth/otp/verify",
    me: "/v1/auth/me",
    logout: "/v1/auth/logout",
    idleMinutes: config.sessionIdleMinutes,
  },
  {
    name: "admin",
    table: "admin_sessions",
    login: adminLogin,
    verify: "/v1/admin/auth/otp/verify",
    me: "/v1/admin/auth/me",
    logout: "/v1/admin/auth/logout",
    idleMinutes: config.adminSessionIdleMinutes,
  },
] as const;

test("idle windows default to 60 min (merchant) and 30 min (admin)", () => {
  assert.equal(config.sessionIdleMinutes, 60);
  assert.equal(config.adminSessionIdleMinutes, 30);
});

for (const side of sides) {
  /** Logs in through the real flow and returns the session cookie and the
   *  token hash that identifies its row. */
  async function loggedIn(): Promise<{ cookie: string; tokenHash: string }> {
    const login = await side.login();
    assert.equal(login.statusCode, 200, login.body);
    const verify = await app.inject({
      method: "POST",
      url: side.verify,
      headers: { cookie: cookieOf(login.headers["set-cookie"]) },
      payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
    });
    assert.equal(verify.statusCode, 200, verify.body);
    const cookie = cookieOf(verify.headers["set-cookie"]);
    return { cookie, tokenHash: sha256Hex(cookie.slice(cookie.indexOf("=") + 1)) };
  }

  async function setLastSeen(tokenHash: string, secondsAgo: number): Promise<void> {
    await pool.query(
      `UPDATE ${side.table} SET last_seen_at = now() - make_interval(secs => $2) WHERE token_hash = $1`,
      [tokenHash, secondsAgo],
    );
  }

  async function rowState(tokenHash: string): Promise<{ xmin: string; idleSeconds: number }> {
    const r = await pool.query<{ xmin: string; idle_seconds: number }>(
      `SELECT xmin::text AS xmin, EXTRACT(EPOCH FROM now() - last_seen_at)::float8 AS idle_seconds
         FROM ${side.table} WHERE token_hash = $1`,
      [tokenHash],
    );
    return { xmin: r.rows[0]!.xmin, idleSeconds: r.rows[0]!.idle_seconds };
  }

  test(`${side.name}: a session idle longer than the window is dead (401)`, async () => {
    const { cookie, tokenHash } = await loggedIn();
    await setLastSeen(tokenHash, side.idleMinutes * 60 + 60);
    const me = await app.inject({ method: "GET", url: side.me, headers: { cookie } });
    assert.equal(me.statusCode, 401, "an idle session must not authenticate");
  });

  test(`${side.name}: a session used inside the window stays alive and is touched`, async () => {
    const { cookie, tokenHash } = await loggedIn();
    await setLastSeen(tokenHash, side.idleMinutes * 60 - 60);
    const me = await app.inject({ method: "GET", url: side.me, headers: { cookie } });
    assert.equal(me.statusCode, 200, me.body);
    const after = await rowState(tokenHash);
    assert.ok(after.idleSeconds < 5, `use must move last_seen_at forward (idle ${after.idleSeconds}s)`);
  });

  test(`${side.name}: the touch is throttled (no write when last seen under a minute ago)`, async () => {
    const { cookie, tokenHash } = await loggedIn();
    await setLastSeen(tokenHash, 20);
    const before = await rowState(tokenHash);
    for (let i = 0; i < 3; i++) {
      const me = await app.inject({ method: "GET", url: side.me, headers: { cookie } });
      assert.equal(me.statusCode, 200, me.body);
    }
    const after = await rowState(tokenHash);
    assert.equal(after.xmin, before.xmin, "the row must not be rewritten on every request");
  });

  test(`${side.name}: logout revokes the session server-side`, async () => {
    const { cookie, tokenHash } = await loggedIn();
    const out = await app.inject({ method: "POST", url: side.logout, headers: { cookie } });
    assert.equal(out.statusCode, 204, out.body);
    const r = await pool.query(`SELECT revoked_at FROM ${side.table} WHERE token_hash = $1`, [tokenHash]);
    assert.ok(r.rows[0].revoked_at, "logout must set revoked_at");
    const me = await app.inject({ method: "GET", url: side.me, headers: { cookie } });
    assert.equal(me.statusCode, 401, "a copy of the cookie must not work after logout");
  });
}
