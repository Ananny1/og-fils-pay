/**
 * BUG-011: the OTP guess budget must hold under parallel requests and across
 * resends, a code can be consumed once, and codes come from a CSPRNG. Covers
 * the merchant and the admin login. Real migrated Postgres (DATABASE_URL).
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
import { generateOtpCode } from "../auth/otp.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("auth.otpLimit.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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
const PASSWORD = "otp-limit-test-password-1!";

test.after(async () => {
  await app.close();
  await pool.end();
  await rm(kycUploadDir, { recursive: true, force: true });
});

function cookieOf(header: string | string[] | undefined): string {
  return (Array.isArray(header) ? header[0] : header)!.split(";")[0]!;
}

/** A fresh merchant, logged in up to the OTP step. */
async function merchantPendingLogin(): Promise<{ cookie: string; code: string }> {
  const email = `otp-limit-${randomUUID()}@example.test`;
  const signup = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `OTP Limit ${randomUUID().slice(0, 8)}`,
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
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password: PASSWORD } });
  assert.equal(login.statusCode, 200, login.body);
  return { cookie: cookieOf(login.headers["set-cookie"]), code: (login.json() as { devOtpCode: string }).devOtpCode };
}

/** A fresh admin, logged in up to the OTP step. */
async function adminPendingLogin(): Promise<{ cookie: string; code: string }> {
  const email = `otp-limit-${randomUUID()}@admin.test`;
  await pool.query(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'OTP Limit', 'support')`,
    [email, await hashPassword(PASSWORD, config)],
  );
  const login = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password: PASSWORD } });
  assert.equal(login.statusCode, 200, login.body);
  return { cookie: cookieOf(login.headers["set-cookie"]), code: (login.json() as { devOtpCode: string }).devOtpCode };
}

function wrongCode(code: string): string {
  return code === "000000" ? "111111" : "000000";
}

async function latestChallenge(table: "otp_challenges" | "admin_otp_challenges") {
  const r = await pool.query<{ attempt_count: number; max_attempts: number }>(
    `SELECT attempt_count, max_attempts FROM ${table} ORDER BY created_at DESC LIMIT 1`,
  );
  return r.rows[0]!;
}

for (const side of [
  { name: "merchant", start: merchantPendingLogin, url: "/v1/auth/otp/verify", table: "otp_challenges" as const },
  { name: "admin", start: adminPendingLogin, url: "/v1/admin/auth/otp/verify", table: "admin_otp_challenges" as const },
]) {
  test(`${side.name}: 20 parallel wrong guesses are held to max_attempts`, async () => {
    const { cookie, code } = await side.start();
    const replies = await Promise.all(
      Array.from({ length: 20 }, () =>
        app.inject({ method: "POST", url: side.url, headers: { cookie }, payload: { code: wrongCode(code) } }),
      ),
    );
    const evaluated = replies.filter((r) => r.statusCode === 401 && r.json().error === "invalid_code").length;
    const challenge = await latestChallenge(side.table);
    assert.ok(evaluated <= challenge.max_attempts, `${evaluated} guesses were checked, limit ${challenge.max_attempts}`);
    assert.ok(challenge.attempt_count <= challenge.max_attempts, `attempt_count ${challenge.attempt_count}`);
  });

  test(`${side.name}: two parallel correct codes log in exactly once`, async () => {
    const { cookie, code } = await side.start();
    const replies = await Promise.all(
      [0, 1].map(() => app.inject({ method: "POST", url: side.url, headers: { cookie }, payload: { code } })),
    );
    assert.equal(replies.filter((r) => r.statusCode === 200).length, 1);
  });
}

test("merchant: a resend keeps the attempts already used", async () => {
  const { cookie, code } = await merchantPendingLogin();
  for (let i = 0; i < 4; i++) {
    const r = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie }, payload: { code: wrongCode(code) } });
    assert.equal(r.statusCode, 401);
  }
  // Get past the 30 s resend throttle without waiting.
  await pool.query(
    `UPDATE otp_challenges SET created_at = created_at - interval '31 seconds'
      WHERE id = (SELECT id FROM otp_challenges ORDER BY created_at DESC LIMIT 1)`,
  );
  const resend = await app.inject({ method: "POST", url: "/v1/auth/otp/resend", headers: { cookie } });
  assert.equal(resend.statusCode, 200, resend.body);
  assert.equal((await latestChallenge("otp_challenges")).attempt_count, 4, "the new challenge must carry the 4 used attempts");
});

test("OTP codes don't come from Math.random", () => {
  const original = Math.random;
  Math.random = () => {
    throw new Error("Math.random used for an OTP code");
  };
  try {
    const code = generateOtpCode(6);
    assert.match(code, /^\d{6}$/);
  } finally {
    Math.random = original;
  }
});
