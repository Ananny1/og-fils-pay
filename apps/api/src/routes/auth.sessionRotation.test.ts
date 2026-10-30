/**
 * BUG-032: the cookie handed out before the OTP must not become a logged-in
 * session (fixation), and the logged-in cookie must live as long as the
 * session. Merchant and admin logins. Real migrated Postgres (DATABASE_URL).
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
  throw new Error("auth.sessionRotation.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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
const PASSWORD = "rotation-test-password-1!";

test.after(async () => {
  await app.close();
  await pool.end();
  await rm(kycUploadDir, { recursive: true, force: true });
});

function setCookieOf(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}
function cookieOf(header: string | string[] | undefined): string {
  return setCookieOf(header)!.split(";")[0]!;
}

async function merchantLogin() {
  const email = `rotation-${randomUUID()}@example.test`;
  const signup = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `Rotation ${randomUUID().slice(0, 8)}`,
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
  const email = `rotation-${randomUUID()}@admin.test`;
  await pool.query(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'Rotation', 'support')`,
    [email, await hashPassword(PASSWORD, config)],
  );
  return app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password: PASSWORD } });
}

for (const side of [
  { name: "merchant", login: merchantLogin, verify: "/v1/auth/otp/verify", me: "/v1/auth/me", ttlHours: config.sessionTtlHours },
  { name: "admin", login: adminLogin, verify: "/v1/admin/auth/otp/verify", me: "/v1/admin/auth/me", ttlHours: config.adminSessionTtlHours },
]) {
  test(`${side.name}: the pre-OTP cookie does not become a logged-in session`, async () => {
    const login = await side.login();
    assert.equal(login.statusCode, 200, login.body);
    const pendingCookie = cookieOf(login.headers["set-cookie"]);

    const verify = await app.inject({
      method: "POST",
      url: side.verify,
      headers: { cookie: pendingCookie },
      payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
    });
    assert.equal(verify.statusCode, 200, verify.body);
    assert.ok(setCookieOf(verify.headers["set-cookie"]), "verify must hand out a fresh session cookie");
    const sessionCookie = cookieOf(verify.headers["set-cookie"]);
    assert.notEqual(sessionCookie, pendingCookie, "the session token must be new after the OTP");

    // A copy of the pre-OTP cookie (e.g. taken from a shared machine) gets nothing.
    const withOld = await app.inject({ method: "GET", url: side.me, headers: { cookie: pendingCookie } });
    assert.equal(withOld.statusCode, 401);
    const withNew = await app.inject({ method: "GET", url: side.me, headers: { cookie: sessionCookie } });
    assert.equal(withNew.statusCode, 200, withNew.body);
  });

  test(`${side.name}: the logged-in cookie lives as long as the session, not the 10-minute pending window`, async () => {
    const login = await side.login();
    const verify = await app.inject({
      method: "POST",
      url: side.verify,
      headers: { cookie: cookieOf(login.headers["set-cookie"]) },
      payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
    });
    assert.equal(verify.statusCode, 200, verify.body);
    const header = setCookieOf(verify.headers["set-cookie"]) ?? "";
    assert.match(header, new RegExp(`Max-Age=${side.ttlHours * 3600}\\b`));
  });
}
