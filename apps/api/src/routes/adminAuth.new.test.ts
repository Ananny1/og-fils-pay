/**
 * Regression tests for the admin login flow (password -> OTP -> session).
 * Real Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../adminAuth/passwords.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("adminAuth.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const ADMIN_PASSWORD = "admin-test-password-9000!";

function parseCookie(setCookieHeader: string | string[] | undefined, name: string): string {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const header of headers) {
    if (header && header.startsWith(`${name}=`)) return header.split(";")[0] as string;
  }
  throw new Error(`expected a Set-Cookie header for ${name}`);
}

async function adminPendingLogin(label: string) {
  const email = `${label}-${randomUUID()}@admin.test`;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'Test', 'finance') RETURNING id`,
    [email, await hashPassword(ADMIN_PASSWORD, config)],
  );
  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/login",
    payload: { email, password: ADMIN_PASSWORD },
  });
  assert.equal(res.statusCode, 200, res.body);
  return {
    adminUserId: user.rows[0]!.id,
    cookie: parseCookie(res.headers["set-cookie"], config.adminCookieName),
    code: res.json().devOtpCode as string,
  };
}

test("BUG-011: parallel wrong admin OTP guesses cannot exceed max_attempts", async () => {
  const { adminUserId, cookie, code } = await adminPendingLogin("admin-otp-race");
  const wrong = code === "000000" ? "111111" : "000000";

  const results = await Promise.all(
    Array.from({ length: 25 }, () =>
      app.inject({ method: "POST", url: "/v1/admin/auth/otp/verify", headers: { cookie }, payload: { code: wrong } }),
    ),
  );
  const guessesChecked = results.filter((r) => r.statusCode === 401 && r.json().error === "invalid_code").length;
  assert.ok(
    guessesChecked <= config.adminOtpMaxAttempts,
    `${guessesChecked} admin guesses were checked; the cap is ${config.adminOtpMaxAttempts}`,
  );

  const row = await pool.query<{ attempt_count: number }>(
    `SELECT attempt_count FROM admin_otp_challenges WHERE admin_user_id = $1`,
    [adminUserId],
  );
  assert.ok(row.rows[0]!.attempt_count <= config.adminOtpMaxAttempts);
});
