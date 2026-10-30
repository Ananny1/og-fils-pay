/**
 * Issuing a credit moves money (a sub-threshold credit posts to the ledger
 * immediately), so it is a finance/super_admin action — a support operator
 * gets a 403 and nothing is posted. Real Postgres via DATABASE_URL.
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
  throw new Error("adminCredits.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

async function signedInAdmin(role: "support" | "finance" | "super_admin", label: string): Promise<string> {
  const email = `${label}-${randomUUID()}@admin.test`;
  await pool.query(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, $3, $4)`,
    [email, await hashPassword(ADMIN_PASSWORD, config), `${label} ${randomUUID().slice(0, 8)}`, role],
  );
  const loginRes = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password: ADMIN_PASSWORD } });
  assert.equal(loginRes.statusCode, 200, loginRes.body);
  const cookie = parseCookie(loginRes.headers["set-cookie"], config.adminCookieName);
  const verify = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/otp/verify",
    headers: { cookie },
    payload: { code: loginRes.json().devOtpCode },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  return cookie;
}

test("BUG-035: a support admin cannot issue a credit; finance can", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Credit Gate ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const payload = { baseAmountFils: 10_000, reasonCode: "goodwill", effectiveDate: new Date().toISOString().slice(0, 10) };

  const support = await signedInAdmin("support", "credit-support");
  const denied = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/credits`,
    headers: { cookie: support },
    payload,
  });
  assert.equal(denied.statusCode, 403, `support issued a credit: ${denied.statusCode} ${denied.body}`);
  const none = await pool.query(`SELECT 1 FROM credit_requests WHERE merchant_id = $1`, [merchantId]);
  assert.equal(none.rowCount, 0, "nothing may be recorded or posted for a refused credit");

  const finance = await signedInAdmin("finance", "credit-finance");
  const ok = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/credits`,
    headers: { cookie: finance },
    payload,
  });
  assert.equal(ok.statusCode, 201, ok.body);

  // Reading the queue stays open to support.
  const list = await app.inject({ method: "GET", url: "/v1/admin/credits", headers: { cookie: support } });
  assert.equal(list.statusCode, 200, list.body);
});
