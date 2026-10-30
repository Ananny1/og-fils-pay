/**
 * BUG-078: logging out of the staff console must also end the operator's
 * open "view as merchant" grants. Real Postgres via DATABASE_URL.
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
  throw new Error("adminLogoutEndsImpersonation.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

type AdminRole = "support" | "finance" | "super_admin";
const ADMIN_PASSWORD = "admin-test-password-9000!";
let cachedHash: string | null = null;

function parseCookie(setCookieHeader: string | string[] | undefined, name: string): string {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const header of headers) {
    if (header && header.startsWith(`${name}=`)) return header.split(";")[0] as string;
  }
  throw new Error(`expected a Set-Cookie header for ${name}`);
}

async function signedInAdmin(role: AdminRole, label: string) {
  cachedHash ??= await hashPassword(ADMIN_PASSWORD, config);
  const email = `${label}-${randomUUID()}@admin.test`;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, cachedHash, `Test ${role}`, role],
  );
  const loginRes = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/login",
    payload: { email, password: ADMIN_PASSWORD },
  });
  assert.equal(loginRes.statusCode, 200, loginRes.body);
  const cookie = parseCookie(loginRes.headers["set-cookie"], config.adminCookieName);
  const verifyRes = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/otp/verify",
    headers: { cookie },
    payload: { code: loginRes.json().devOtpCode },
  });
  assert.equal(verifyRes.statusCode, 200, verifyRes.body);
  // The session token is rotated at OTP verify (BUG-032): use the new cookie.
  return { id: user.rows[0]!.id, cookie: parseCookie(verifyRes.headers["set-cookie"], config.adminCookieName) };
}

async function createMerchant(label: string): Promise<string> {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Impersonated ${label} ${randomUUID()}`],
  );
  return merchant.rows[0]!.id;
}

async function impersonate(adminCookie: string, merchantId: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/impersonate`,
    headers: { cookie: adminCookie },
  });
  assert.equal(res.statusCode, 201, res.body);
  return parseCookie(res.headers["set-cookie"], config.impersonationCookieName);
}

test("admin logout ends that admin's open impersonation grants", async () => {
  const admin = await signedInAdmin("support", "logout-imp");
  const merchantId = await createMerchant("logout");
  const impCookie = await impersonate(admin.cookie, merchantId);

  const before = await app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie: impCookie } });
  assert.equal(before.statusCode, 200, before.body);

  const logout = await app.inject({ method: "POST", url: "/v1/admin/auth/logout", headers: { cookie: admin.cookie } });
  assert.equal(logout.statusCode, 204, logout.body);

  const after = await app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie: impCookie } });
  assert.equal(after.statusCode, 401, `grant still reads merchant data after logout: ${after.body.slice(0, 120)}`);
});

