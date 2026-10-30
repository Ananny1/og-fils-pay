/**
 * BUG-002: the OTP challenge and pending session must belong to the user
 * whose password was checked, never to another merchant's user who happens
 * to share the email. Route-level, real migrated Postgres (DATABASE_URL).
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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("auth.otpRecipient.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

test.after(async () => {
  await app.close();
  await pool.end();
  await rm(kycUploadDir, { recursive: true, force: true });
});

async function signup(label: string, email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `OTP Recipient ${label} ${randomUUID().slice(0, 8)}`,
        registrationNumber: `RC-${randomUUID().slice(0, 8)}`,
        businessType: "llc",
        contactEmail: `contact-${randomUUID()}@example.test`,
        contactPhone: "+97300000000",
        addressLine1: "1 Test Street",
        city: "Manama",
      },
      owner: { email, password },
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { merchantId: string }).merchantId;
}

/** Password step + OTP step; returns who /me says we are. */
async function loginAndVerify(merchantId: string, email: string, password: string) {
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });
  assert.equal(login.statusCode, 200, login.body);
  const cookieHeader = login.headers["set-cookie"];
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(";")[0]!;
  const verify = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    headers: { cookie },
    payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  // The session token is rotated at OTP verify (BUG-032): use the cookie it sets.
  const sessionHeader = verify.headers["set-cookie"];
  const sessionCookie = (Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader)!.split(";")[0]!;
  const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: sessionCookie } });
  assert.equal(me.statusCode, 200, me.body);
  return me.json() as { merchantUserId: string; merchant: { id: string } };
}

test("two merchants sharing an owner email: each login lands in its own merchant", async () => {
  const email = `shared-${randomUUID()}@example.test`;
  const merchantA = await signup("A", email, "password-for-merchant-a-1234");
  const merchantB = await signup("B", email, "password-for-merchant-b-5678");

  const meA = await loginAndVerify(merchantA, email, "password-for-merchant-a-1234");
  const meB = await loginAndVerify(merchantB, email, "password-for-merchant-b-5678");

  assert.equal(meA.merchant.id, merchantA, "logging into A must land in A");
  assert.equal(meB.merchant.id, merchantB, "logging into B must land in B");
});

test("the OTP challenge is issued to the user whose password was checked", async () => {
  const email = `shared-${randomUUID()}@example.test`;
  const merchantA = await signup("A", email, "password-for-merchant-a-1234");
  const merchantB = await signup("B", email, "password-for-merchant-b-5678");

  for (const [merchantId, password] of [
    [merchantA, "password-for-merchant-a-1234"],
    [merchantB, "password-for-merchant-b-5678"],
  ] as const) {
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });
    assert.equal(login.statusCode, 200, login.body);
    const row = await pool.query<{ challenge_merchant_id: string }>(
      `SELECT mu.merchant_id AS challenge_merchant_id
         FROM otp_challenges oc
         JOIN merchant_users mu ON mu.id = oc.merchant_user_id
        WHERE mu.email = $1
        ORDER BY oc.created_at DESC
        LIMIT 1`,
      [email],
    );
    assert.equal(row.rows[0]?.challenge_merchant_id, merchantId);
  }
});
