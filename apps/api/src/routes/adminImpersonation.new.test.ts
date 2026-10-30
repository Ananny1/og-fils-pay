/**
 * Regression tests: an admin "view as merchant" grant is read-only, whatever
 * the admin's own role, and dies with the admin's account. Real Postgres via
 * DATABASE_URL.
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
  throw new Error("adminImpersonation.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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
  return { id: user.rows[0]!.id, cookie };
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

for (const role of ["super_admin", "finance", "support"] as const) {
  test(`BUG-010: a ${role} impersonation grant can read but cannot write as the merchant`, async () => {
    const admin = await signedInAdmin(role, `imp-${role}`);
    const merchantId = await createMerchant(role);
    const impCookie = await impersonate(admin.cookie, merchantId);

    const read = await app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie: impCookie } });
    assert.equal(read.statusCode, 200, read.body);

    const writes: Array<{ method: "POST" | "PATCH" | "DELETE"; url: string; payload?: Record<string, unknown> }> = [
      {
        method: "POST",
        url: `/v1/merchants/${merchantId}/payment-links`,
        payload: { amountFils: 1000, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      },
      { method: "POST", url: `/v1/merchants/${merchantId}/webhook-endpoints`, payload: { url: "http://127.0.0.1:9/h" } },
      { method: "POST", url: `/v1/transactions/${randomUUID()}/capture`, payload: {} },
      { method: "POST", url: `/v1/transactions/${randomUUID()}/void`, payload: {} },
      { method: "POST", url: "/v1/reporting/saved-filters", payload: { name: "x", filter: {} } },
    ];
    for (const w of writes) {
      const res = await app.inject({
        method: w.method,
        url: w.url,
        headers: { cookie: impCookie, "idempotency-key": randomUUID() },
        payload: w.payload,
      });
      assert.equal(res.statusCode, 403, `${role} impersonation ${w.method} ${w.url} -> ${res.statusCode} ${res.body}`);
    }

    const links = await pool.query(`SELECT 1 FROM payment_links WHERE merchant_id = $1`, [merchantId]);
    assert.equal(links.rowCount, 0, "no payment link may be created under impersonation");
  });
}

test("BUG-010: a disabled admin's impersonation grant stops working immediately", async () => {
  const admin = await signedInAdmin("support", "imp-disabled");
  const merchantId = await createMerchant("disabled");
  const impCookie = await impersonate(admin.cookie, merchantId);

  const before = await app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie: impCookie } });
  assert.equal(before.statusCode, 200, before.body);

  await pool.query(`UPDATE admin_users SET status = 'disabled' WHERE id = $1`, [admin.id]);

  const after = await app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie: impCookie } });
  assert.equal(after.statusCode, 401, "a disabled admin must lose merchant access too");
});
