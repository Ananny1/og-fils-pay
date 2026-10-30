/**
 * BUG-069: a merchant `support` user (dashboard session) must not be able
 * to capture or void a payment. Those move money; support looks things up.
 * Requires DATABASE_URL (a real, migrated Postgres).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("transactions.roles.new.test.ts requires DATABASE_URL");

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const VALID_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

async function setup() {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Roles Merchant ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });

  const cookies: Record<string, string> = {};
  let ownerId = "";
  for (const role of ["owner", "finance", "support"] as const) {
    const u = await pool.query<{ id: string }>(
      `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
       VALUES ($1, $2, $3, 'unused') RETURNING id`,
      [merchantId, `${role}-${randomUUID()}@example.test`, role],
    );
    if (role === "owner") ownerId = u.rows[0]!.id;
    const raw = randomToken(32);
    await pool.query(
      `INSERT INTO sessions (merchant_user_id, token_hash, authenticated, authenticated_at, expires_at)
       VALUES ($1, $2, true, now(), now() + interval '1 hour')`,
      [u.rows[0]!.id, sha256Hex(raw)],
    );
    cookies[role] = raw;
  }
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: ownerId, label: "roles" });
  return { cookies, rawKey };
}

async function authorize(rawKey: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: { amountFils: 5_000, card: VALID_CARD, reference: "roles" },
  });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { id: string }).id;
}

function asSession(token: string) {
  return { cookie: `${config.cookieName}=${token}`, "idempotency-key": randomUUID() };
}

test("support session cannot capture; the transaction stays authorized", async () => {
  const { cookies, rawKey } = await setup();
  const id = await authorize(rawKey);
  const res = await app.inject({
    method: "POST",
    url: `/v1/transactions/${id}/capture`,
    headers: asSession(cookies.support!),
    payload: {},
  });
  assert.equal(res.statusCode, 403, res.body);
  const row = await pool.query<{ status: string }>(`SELECT status FROM transactions WHERE id = $1`, [id]);
  assert.equal(row.rows[0]!.status, "authorized");
});

test("support session cannot void; the transaction stays authorized", async () => {
  const { cookies, rawKey } = await setup();
  const id = await authorize(rawKey);
  const res = await app.inject({
    method: "POST",
    url: `/v1/transactions/${id}/void`,
    headers: asSession(cookies.support!),
    payload: {},
  });
  assert.equal(res.statusCode, 403, res.body);
  const row = await pool.query<{ status: string }>(`SELECT status FROM transactions WHERE id = $1`, [id]);
  assert.equal(row.rows[0]!.status, "authorized");
});

test("owner and finance sessions can still capture and void; API keys still can", async () => {
  const { cookies, rawKey } = await setup();
  for (const role of ["owner", "finance"] as const) {
    const a = await authorize(rawKey);
    const cap = await app.inject({
      method: "POST",
      url: `/v1/transactions/${a}/capture`,
      headers: asSession(cookies[role]!),
      payload: {},
    });
    assert.equal(cap.statusCode, 200, `${role} capture: ${cap.body}`);
    const b = await authorize(rawKey);
    const v = await app.inject({
      method: "POST",
      url: `/v1/transactions/${b}/void`,
      headers: asSession(cookies[role]!),
      payload: {},
    });
    assert.equal(v.statusCode, 200, `${role} void: ${v.body}`);
  }
  const c = await authorize(rawKey);
  const capKey = await app.inject({
    method: "POST",
    url: `/v1/transactions/${c}/capture`,
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: {},
  });
  assert.equal(capKey.statusCode, 200, capKey.body);
});
