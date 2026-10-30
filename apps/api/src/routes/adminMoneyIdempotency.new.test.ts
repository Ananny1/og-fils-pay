/**
 * BUG-109: an admin credit or balance adjustment sent twice with the same
 * Idempotency-Key (a double click, or a retry after a lost reply) must post
 * once. Same key + same body replays the first answer; same key + different
 * body is a 422. Real Postgres via DATABASE_URL.
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
  throw new Error("adminMoneyIdempotency.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

async function signedInFinance(): Promise<string> {
  const email = `idem-${randomUUID()}@admin.test`;
  await pool.query(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, $3, 'finance')`,
    [email, await hashPassword(ADMIN_PASSWORD, config), `Idem ${randomUUID().slice(0, 8)}`],
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
  return parseCookie(verify.headers["set-cookie"], config.adminCookieName);
}

async function createMerchant(balanceFils: number): Promise<string> {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Idem ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  await pool.query(`INSERT INTO merchant_balances (merchant_id, cached_payable_fils) VALUES ($1, $2)`, [
    merchantId,
    balanceFils,
  ]);
  return merchantId;
}

async function balance(merchantId: string): Promise<number> {
  const r = await pool.query<{ c: string }>(
    `SELECT cached_payable_fils::text AS c FROM merchant_balances WHERE merchant_id = $1`,
    [merchantId],
  );
  return Number(r.rows[0]!.c);
}

test("BUG-109: a credit sent twice with the same Idempotency-Key posts once", async () => {
  const cookie = await signedInFinance();
  const merchantId = await createMerchant(0);
  const key = randomUUID();
  const payload = { baseAmountFils: 10_000, reasonCode: "goodwill", effectiveDate: new Date().toISOString().slice(0, 10) };
  const send = (body: object) =>
    app.inject({
      method: "POST",
      url: `/v1/admin/merchants/${merchantId}/credits`,
      headers: { cookie, "idempotency-key": key },
      payload: body,
    });

  const first = await send(payload);
  assert.equal(first.statusCode, 201, first.body);
  const second = await send(payload);
  assert.equal(second.statusCode, 201, second.body);

  const rows = await pool.query(`SELECT 1 FROM credit_requests WHERE merchant_id = $1`, [merchantId]);
  assert.equal(rows.rowCount, 1, "exactly one credit request");
  assert.equal(await balance(merchantId), 10_000, "posted once");
  assert.equal(second.json().id, first.json().id, "the retry must replay the first credit, not create another");

  const changed = await send({ ...payload, baseAmountFils: 20_000 });
  assert.equal(changed.statusCode, 422, changed.body);
  assert.equal(await balance(merchantId), 10_000);
});

test("BUG-109: a balance adjustment sent twice with the same Idempotency-Key posts once", async () => {
  const cookie = await signedInFinance();
  const merchantId = await createMerchant(100_000);
  const key = randomUUID();
  const send = (body: object) =>
    app.inject({
      method: "POST",
      url: `/v1/admin/merchants/${merchantId}/balance-adjustments`,
      headers: { cookie, "idempotency-key": key },
      payload: body,
    });

  const first = await send({ deltaFils: 5_000, reason: "statement check" });
  assert.equal(first.statusCode, 200, first.body);
  const second = await send({ deltaFils: 5_000, reason: "statement check" });
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(await balance(merchantId), 105_000, "adjusted once, not twice");
  assert.deepEqual(second.json(), first.json(), "the retry replays the first answer");

  const changed = await send({ deltaFils: 7_000, reason: "statement check" });
  assert.equal(changed.statusCode, 422, changed.body);
  assert.equal(await balance(merchantId), 105_000);

  // A different key is a new, intended action.
  const other = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/balance-adjustments`,
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: { deltaFils: 5_000, reason: "statement check" },
  });
  assert.equal(other.statusCode, 200, other.body);
  assert.equal(await balance(merchantId), 110_000);
});

test("BUG-109: the same key from two different admins is two separate actions", async () => {
  const a = await signedInFinance();
  const b = await signedInFinance();
  const merchantId = await createMerchant(0);
  const key = randomUUID();
  for (const cookie of [a, b]) {
    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/merchants/${merchantId}/balance-adjustments`,
      headers: { cookie, "idempotency-key": key },
      payload: { deltaFils: 1_000, reason: "two admins" },
    });
    assert.equal(res.statusCode, 200, res.body);
  }
  assert.equal(await balance(merchantId), 2_000);
});
