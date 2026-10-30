/**
 * SEC-1: login and OTP brute-force limits and account lockout, on the
 * merchant and the admin login. Every test uses its own fake client IP
 * (`remoteAddress`) so the per-IP buckets don't leak between tests. Real
 * migrated Postgres (DATABASE_URL).
 */
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../auth/passwords.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("auth.throttle.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const kycUploadDir = mkdtempSync(join(tmpdir(), "filspay-kyc-test-"));
const baseEnv = {
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  KYC_UPLOAD_DIR: kycUploadDir,
  OTP_DEV_EXPOSE: "true",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
};
const config = loadConfig(baseEnv);
const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const app = buildApp(config, pool);
const proxiedApp = buildApp(loadConfig({ ...baseEnv, TRUST_PROXY: "true" }), pool);
const PASSWORD = "throttle-test-password-1!";

test.after(async () => {
  await app.close();
  await proxiedApp.close();
  await pool.end();
  await rm(kycUploadDir, { recursive: true, force: true });
});

/** A fresh, unused fake client address per call. */
function freshIp(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

function cookieOf(header: string | string[] | undefined): string {
  return (Array.isArray(header) ? header[0] : header)!.split(";")[0]!;
}

interface Account {
  loginUrl: string;
  verifyUrl: string;
  /** Login payload for this account with the given password. */
  body(password: string): Record<string, string>;
  /** Login payload for an account that doesn't exist. */
  unknownBody(password: string): Record<string, string>;
}

async function merchantAccount(): Promise<Account> {
  const email = `throttle-${randomUUID()}@example.test`;
  const signup = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `Throttle ${randomUUID().slice(0, 8)}`,
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
  return {
    loginUrl: "/v1/auth/login",
    verifyUrl: "/v1/auth/otp/verify",
    body: (password) => ({ merchantId, email, password }),
    unknownBody: (password) => ({ merchantId, email: `nobody-${randomUUID()}@example.test`, password }),
  };
}

async function adminAccount(): Promise<Account> {
  const email = `throttle-${randomUUID()}@admin.test`;
  await pool.query(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'Throttle', 'support')`,
    [email, await hashPassword(PASSWORD, config)],
  );
  return {
    loginUrl: "/v1/admin/auth/login",
    verifyUrl: "/v1/admin/auth/otp/verify",
    body: (password) => ({ email, password }),
    unknownBody: (password) => ({ email: `nobody-${randomUUID()}@admin.test`, password }),
  };
}

function login(target: FastifyInstance, url: string, payload: Record<string, string>, ip: string, headers = {}) {
  return target.inject({ method: "POST", url, payload, remoteAddress: ip, headers });
}

/** Moves every recorded failure and lockout of this test's rows into the past. */
async function age(seconds: number): Promise<void> {
  await pool.query(`UPDATE auth_failures SET created_at = created_at - make_interval(secs => $1)`, [seconds]);
  await pool.query(`UPDATE auth_lockouts SET locked_until = locked_until - make_interval(secs => $1)`, [seconds]);
}

for (const side of [
  { name: "merchant", make: merchantAccount },
  { name: "admin", make: adminAccount },
]) {
  test(`${side.name}: the 6th wrong password from one IP for one email in a minute gets 429`, async () => {
    const account = await side.make();
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      const r = await login(app, account.loginUrl, account.body("wrong-password"), ip);
      assert.equal(r.statusCode, 401, r.body);
    }
    const blocked = await login(app, account.loginUrl, account.body(PASSWORD), ip);
    assert.equal(blocked.statusCode, 429, blocked.body);
    assert.equal(blocked.json().error, "too_many_attempts");
    assert.ok(Number(blocked.headers["retry-after"]) > 0, "Retry-After header is set");
  });

  test(`${side.name}: 20 parallel wrong passwords are held to the per-email limit`, async () => {
    const account = await side.make();
    const ip = freshIp();
    const replies = await Promise.all(
      Array.from({ length: 20 }, () => login(app, account.loginUrl, account.body("wrong-password"), ip)),
    );
    const checked = replies.filter((r) => r.statusCode === 401).length;
    assert.ok(checked <= 5, `${checked} passwords were checked, limit 5`);
  });

  test(`${side.name}: one IP spraying many emails is stopped at the per-IP limit`, async () => {
    const account = await side.make();
    const ip = freshIp();
    for (let i = 0; i < 30; i++) {
      const r = await login(app, account.loginUrl, account.unknownBody("wrong-password"), ip);
      assert.equal(r.statusCode, 401, `attempt ${i + 1}: ${r.body}`);
    }
    const blocked = await login(app, account.loginUrl, account.body(PASSWORD), ip);
    assert.equal(blocked.statusCode, 429, blocked.body);
  });

  test(`${side.name}: 10 failures from different IPs lock the account, and the lock expires`, async () => {
    const account = await side.make();
    for (let i = 0; i < 10; i++) {
      const r = await login(app, account.loginUrl, account.body("wrong-password"), freshIp());
      assert.equal(r.statusCode, 401, r.body);
    }
    // Locked: even the right password from a brand-new IP is refused.
    const locked = await login(app, account.loginUrl, account.body(PASSWORD), freshIp());
    assert.equal(locked.statusCode, 429, locked.body);
    assert.equal(locked.json().error, "too_many_attempts");

    await age(15 * 60 + 1);
    const after = await login(app, account.loginUrl, account.body(PASSWORD), freshIp());
    assert.equal(after.statusCode, 200, after.body);
  });

  test(`${side.name}: a locked unknown email answers exactly like a locked real one`, async () => {
    const account = await side.make();
    const unknown = account.unknownBody("wrong-password");
    for (let i = 0; i < 10; i++) {
      const r = await login(app, account.loginUrl, unknown, freshIp());
      assert.equal(r.statusCode, 401, r.body);
    }
    const locked = await login(app, account.loginUrl, unknown, freshIp());
    assert.equal(locked.statusCode, 429);
    assert.deepEqual(locked.json(), { error: "too_many_attempts", message: "Too many attempts. Try again later." });
  });

  test(`${side.name}: wrong OTP codes across logins count toward the lockout`, async () => {
    const account = await side.make();
    // Two logins x 5 wrong codes = 10 failures for this user.
    for (let round = 0; round < 2; round++) {
      const ip = freshIp();
      const r = await login(app, account.loginUrl, account.body(PASSWORD), freshIp());
      assert.equal(r.statusCode, 200, r.body);
      const cookie = cookieOf(r.headers["set-cookie"]);
      const real = (r.json() as { devOtpCode: string }).devOtpCode;
      const wrong = real === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++) {
        const v = await app.inject({
          method: "POST",
          url: account.verifyUrl,
          headers: { cookie },
          payload: { code: wrong },
          remoteAddress: ip,
        });
        assert.equal(v.statusCode, 401, v.body);
      }
    }
    const locked = await login(app, account.loginUrl, account.body(PASSWORD), freshIp());
    assert.equal(locked.statusCode, 429, "a third login (fresh OTP budget) is refused");
  });

  test(`${side.name}: a successful login resets the failure count`, async () => {
    const account = await side.make();
    const ip = freshIp();
    for (let i = 0; i < 4; i++) {
      assert.equal((await login(app, account.loginUrl, account.body("wrong-password"), ip)).statusCode, 401);
    }
    const ok = await login(app, account.loginUrl, account.body(PASSWORD), ip);
    assert.equal(ok.statusCode, 200, ok.body);
    const verified = await app.inject({
      method: "POST",
      url: account.verifyUrl,
      headers: { cookie: cookieOf(ok.headers["set-cookie"]) },
      payload: { code: (ok.json() as { devOtpCode: string }).devOtpCode },
      remoteAddress: ip,
    });
    assert.equal(verified.statusCode, 200, verified.body);
    // Without the reset, the 2nd of these would be the 6th failure in the minute.
    for (let i = 0; i < 4; i++) {
      const r = await login(app, account.loginUrl, account.body("wrong-password"), ip);
      assert.equal(r.statusCode, 401, `after reset, attempt ${i + 1}: ${r.body}`);
    }
  });
}

test("merchant: the per-minute limit lifts after the window", async () => {
  const account = await merchantAccount();
  const ip = freshIp();
  for (let i = 0; i < 5; i++) {
    await login(app, account.loginUrl, account.body("wrong-password"), ip);
  }
  assert.equal((await login(app, account.loginUrl, account.body(PASSWORD), ip)).statusCode, 429);
  await age(61);
  assert.equal((await login(app, account.loginUrl, account.body(PASSWORD), ip)).statusCode, 200);
});

test("TRUST_PROXY off: a rotating X-Forwarded-For doesn't dodge the limit", async () => {
  const account = await merchantAccount();
  const ip = freshIp();
  for (let i = 0; i < 5; i++) {
    const r = await login(app, account.loginUrl, account.body("wrong-password"), ip, {
      "x-forwarded-for": freshIp(),
    });
    assert.equal(r.statusCode, 401, r.body);
  }
  const blocked = await login(app, account.loginUrl, account.body(PASSWORD), ip, { "x-forwarded-for": freshIp() });
  assert.equal(blocked.statusCode, 429, "the header must be ignored when the API isn't behind our proxy");
});

/** A fresh public (documentation-range) address: never one of our proxies. */
function freshPublicIp(): string {
  return `${randomInt(2) === 0 ? "198.51.100" : "203.0.113"}.${randomInt(1, 255)}`;
}

test("TRUST_PROXY on: the client IP is the one our proxy appended, not a spoofed left entry", async () => {
  const account = await merchantAccount();
  const proxy = freshIp(); // a private compose-network address
  const client = freshPublicIp();
  for (let i = 0; i < 5; i++) {
    // The attacker prepends a fake address; our proxy appends the real one.
    const r = await login(proxiedApp, account.loginUrl, account.body("wrong-password"), proxy, {
      "x-forwarded-for": `${freshPublicIp()}, ${client}`,
    });
    assert.equal(r.statusCode, 401, r.body);
  }
  const blocked = await login(proxiedApp, account.loginUrl, account.body(PASSWORD), proxy, {
    "x-forwarded-for": `${freshPublicIp()}, ${client}`,
  });
  assert.equal(blocked.statusCode, 429, blocked.body);
  // A different real client behind the same proxy is not blocked.
  const other = await login(proxiedApp, account.loginUrl, account.body(PASSWORD), proxy, {
    "x-forwarded-for": client === "203.0.113.254" ? "198.51.100.254" : "203.0.113.254",
  });
  assert.equal(other.statusCode, 200, other.body);
});

test("TRUST_PROXY on: a client reaching the API directly still can't set its own IP", async () => {
  const account = await merchantAccount();
  const direct = freshPublicIp();
  for (let i = 0; i < 5; i++) {
    const r = await login(proxiedApp, account.loginUrl, account.body("wrong-password"), direct, {
      "x-forwarded-for": freshPublicIp(),
    });
    assert.equal(r.statusCode, 401, r.body);
  }
  const blocked = await login(proxiedApp, account.loginUrl, account.body(PASSWORD), direct, {
    "x-forwarded-for": freshPublicIp(),
  });
  assert.equal(blocked.statusCode, 429, "X-Forwarded-For from a non-proxy peer is ignored");
});
