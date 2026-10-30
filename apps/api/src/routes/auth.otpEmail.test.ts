/**
 * ENH-001: with SMTP configured but the mail server down, the merchant and
 * admin logins still answer 200 (the send error is logged; the user can
 * press "resend"). Real nodemailer, real migrated Postgres (DATABASE_URL).
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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("auth.otpEmail.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const kycUploadDir = mkdtempSync(join(tmpdir(), "filspay-kyc-test-"));
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  KYC_UPLOAD_DIR: kycUploadDir,
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  // Nothing listens on port 9 here: every send fails with ECONNREFUSED.
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "9",
});
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const app = buildApp(config, pool);
const PASSWORD = "otp-email-test-password-1!";

test.after(async () => {
  await app.close();
  await pool.end();
  await rm(kycUploadDir, { recursive: true, force: true });
});

test("merchant login still answers 200 when the mail server is down", async () => {
  const email = `otpmail-${randomUUID()}@example.test`;
  const signup = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `OtpMail ${randomUUID().slice(0, 8)}`,
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
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { merchantId, email, password: PASSWORD },
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal((login.json() as { otpRequired: boolean }).otpRequired, true);
  assert.equal("devOtpCode" in (login.json() as object), false);
});

test("admin login still answers 200 when the mail server is down", async () => {
  const email = `otpmail-${randomUUID()}@admin.test`;
  await pool.query(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'OtpMail', 'support')`,
    [email, await hashPassword(PASSWORD, config)],
  );
  const login = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password: PASSWORD } });
  assert.equal(login.statusCode, 200, login.body);
});
