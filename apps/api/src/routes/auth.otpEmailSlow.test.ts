/**
 * ENH-001 follow-up: a mail server that accepts the connection and never
 * answers (the slowest real failure) must not hold up the login reply. A slow
 * reply for real accounts and a fast one for unknown emails would also tell
 * an attacker which accounts exist. Own file: the mail transport is created
 * once per process. Real migrated Postgres (DATABASE_URL).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../auth/passwords.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("auth.otpEmailSlow.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const silent = createServer(() => {});
await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
const kycUploadDir = mkdtempSync(join(tmpdir(), "filspay-kyc-test-"));
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  KYC_UPLOAD_DIR: kycUploadDir,
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: String((silent.address() as { port: number }).port),
});
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const app = buildApp(config, pool);
const PASSWORD = "otp-email-slow-password-1!";

test.after(async () => {
  await app.close();
  await pool.end();
  silent.close();
  await rm(kycUploadDir, { recursive: true, force: true });
});

test("login answers at once even when the mail server never responds", async () => {
  const email = `otpslow-${randomUUID()}@admin.test`;
  await pool.query(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'OtpSlow', 'support')`,
    [email, await hashPassword(PASSWORD, config)],
  );
  const started = Date.now();
  const login = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password: PASSWORD } });
  const took = Date.now() - started;
  assert.equal(login.statusCode, 200, login.body);
  assert.ok(took < 2_000, `login took ${took} ms`);
});
