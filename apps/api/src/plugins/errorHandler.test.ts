/**
 * SEC-RT-6: input Postgres can't parse (a non-UUID id, a malformed date) is
 * the client's mistake: 400, not a 500 "internal_error" that floods the
 * error log and looks like a crash. Real migrated Postgres (DATABASE_URL).
 */
import assert from "node:assert/strict";
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
  throw new Error("errorHandler.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const kycUploadDir = mkdtempSync(join(tmpdir(), "filspay-kyc-test-"));
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  KYC_UPLOAD_DIR: kycUploadDir,
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
  await rm(kycUploadDir, { recursive: true, force: true });
});

test("a non-UUID merchant id on the public login is a 400, not a 500", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { merchantId: "not-a-uuid", email: "someone@example.test", password: "whatever-password-1" },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error, "invalid_input");
  assert.doesNotMatch(res.body, /uuid|syntax|SELECT/i, "no database text leaks to the client");
});

test("a malformed id in a public payment-link path is a 4xx, not a 500", async () => {
  const res = await app.inject({ method: "GET", url: "/v1/payment-links/%27%20OR%201=1--" });
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `${res.statusCode} ${res.body}`);
});
