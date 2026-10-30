/**
 * Route tests for `POST /v1/merchants/:merchantId/refunds` (FP-300.1)
 * against a real, migrated Postgres. Requires `DATABASE_URL`.
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
if (!databaseUrl) {
  throw new Error("refunds.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

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

async function createMerchant(label: string) {
  const merchantResult = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Refund Route ${label} ${randomUUID()}`],
  );
  const merchantId = merchantResult.rows[0]!.id;
  const owner = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: owner.rows[0]!.id, label });
  return { merchantId, rawKey: issued.rawKey };
}

/** A logged-in (OTP done) dashboard session cookie for a new user with `role`. */
async function sessionCookie(merchantId: string, role: "owner" | "finance" | "support"): Promise<string> {
  const user = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, $3, 'unused') RETURNING id`,
    [merchantId, `${role}-${randomUUID()}@example.test`, role],
  );
  const rawToken = randomToken(32);
  await pool.query(
    `INSERT INTO sessions (merchant_user_id, token_hash, authenticated, authenticated_at, expires_at)
     VALUES ($1, $2, true, now(), now() + interval '1 hour')`,
    [user.rows[0]!.id, sha256Hex(rawToken)],
  );
  return `${config.cookieName}=${rawToken}`;
}

async function capturedTransaction(rawKey: string, amountFils: number): Promise<string> {
  const auth = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: { amountFils, card: VALID_CARD, reference: "refund-route" },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  const id = (auth.json() as { id: string }).id;
  const cap = await app.inject({
    method: "POST",
    url: `/v1/transactions/${id}/capture`,
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: {},
  });
  assert.equal(cap.statusCode, 200, cap.body);
  return id;
}

function refund(merchantId: string, headers: Record<string, string>, payload: unknown) {
  return app.inject({ method: "POST", url: `/v1/merchants/${merchantId}/refunds`, headers, payload: payload as object });
}

async function refundCount(transactionId: string): Promise<number> {
  const r = await pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM refunds WHERE transaction_id = $1`, [
    transactionId,
  ]);
  return r.rows[0]!.c;
}

test("an owner session refunds part of its own transaction", async () => {
  const m = await createMerchant("owner");
  const txnId = await capturedTransaction(m.rawKey, 10_000);
  const cookie = await sessionCookie(m.merchantId, "owner");

  const res = await refund(m.merchantId, { cookie, "idempotency-key": randomUUID() }, {
    transactionId: txnId,
    amountFils: 2_500,
    reason: "customer returned one item",
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { amountFils: number; transactionStatus: string; refundedTotalFils: number };
  assert.equal(body.amountFils, 2_500);
  assert.equal(body.transactionStatus, "partially_refunded");
  assert.equal(body.refundedTotalFils, 2_500);

  const row = await pool.query<{ reason: string; created_by_type: string }>(
    `SELECT reason, created_by_type FROM refunds WHERE transaction_id = $1`,
    [txnId],
  );
  assert.equal(row.rows[0]!.reason, "customer returned one item");
  assert.equal(row.rows[0]!.created_by_type, "merchant_session");
});

test("a finance session may refund; a support session may not", async () => {
  const m = await createMerchant("roles");
  const txnId = await capturedTransaction(m.rawKey, 5_000);

  const support = await refund(
    m.merchantId,
    { cookie: await sessionCookie(m.merchantId, "support"), "idempotency-key": randomUUID() },
    { transactionId: txnId },
  );
  assert.equal(support.statusCode, 403, support.body);
  assert.equal(await refundCount(txnId), 0);

  const finance = await refund(
    m.merchantId,
    { cookie: await sessionCookie(m.merchantId, "finance"), "idempotency-key": randomUUID() },
    { transactionId: txnId },
  );
  assert.equal(finance.statusCode, 200, finance.body);
  assert.equal((finance.json() as { amountFils: number }).amountFils, 5_000);
});

test("an API key can refund, and the Idempotency-Key header is required", async () => {
  const m = await createMerchant("api-key");
  const txnId = await capturedTransaction(m.rawKey, 4_000);

  const noKey = await refund(m.merchantId, { authorization: `Bearer ${m.rawKey}` }, { transactionId: txnId });
  assert.equal(noKey.statusCode, 400, noKey.body);
  assert.equal(noKey.json().error, "idempotency_key_required");
  assert.equal(await refundCount(txnId), 0);

  const ok = await refund(
    m.merchantId,
    { authorization: `Bearer ${m.rawKey}`, "idempotency-key": randomUUID() },
    { transactionId: txnId, amountFils: 1_000 },
  );
  assert.equal(ok.statusCode, 200, ok.body);
});

test("the same Idempotency-Key replays the first answer and refunds once", async () => {
  const m = await createMerchant("replay");
  const txnId = await capturedTransaction(m.rawKey, 6_000);
  const headers = { authorization: `Bearer ${m.rawKey}`, "idempotency-key": randomUUID() };

  const first = await refund(m.merchantId, headers, { transactionId: txnId, amountFils: 1_000 });
  const second = await refund(m.merchantId, headers, { transactionId: txnId, amountFils: 1_000 });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(second.statusCode, 200, second.body);
  assert.deepEqual(second.json(), first.json());
  assert.equal(await refundCount(txnId), 1);
});

test("another merchant's path is 403 and another merchant's transaction is 404", async () => {
  const victim = await createMerchant("victim");
  const attacker = await createMerchant("attacker");
  const txnId = await capturedTransaction(victim.rawKey, 3_000);
  const headers = { authorization: `Bearer ${attacker.rawKey}`, "idempotency-key": randomUUID() };

  const wrongPath = await refund(victim.merchantId, headers, { transactionId: txnId });
  assert.equal(wrongPath.statusCode, 403, wrongPath.body);

  const ownPath = await refund(attacker.merchantId, { ...headers, "idempotency-key": randomUUID() }, {
    transactionId: txnId,
  });
  assert.equal(ownPath.statusCode, 404, ownPath.body);
  assert.equal(await refundCount(txnId), 0);
});

test("bad input is a 400 or 404, never a 500", async () => {
  const m = await createMerchant("bad-input");
  const txnId = await capturedTransaction(m.rawKey, 3_000);
  const headers = () => ({ authorization: `Bearer ${m.rawKey}`, "idempotency-key": randomUUID() });

  for (const amountFils of [0, -5, 1.5, "100"]) {
    const res = await refund(m.merchantId, headers(), { transactionId: txnId, amountFils });
    assert.equal(res.statusCode, 400, `${String(amountFils)}: ${res.body}`);
  }
  const missing = await refund(m.merchantId, headers(), {});
  assert.equal(missing.statusCode, 400, missing.body);
  const notUuid = await refund(m.merchantId, headers(), { transactionId: "not-a-uuid" });
  assert.equal(notUuid.statusCode, 404, notUuid.body);
  const over = await refund(m.merchantId, headers(), { transactionId: txnId, amountFils: 3_001 });
  assert.equal(over.statusCode, 422, over.body);
  assert.equal(await refundCount(txnId), 0);
});

test("unauthenticated callers get 401, and the old /v1/refunds stub is gone", async () => {
  const m = await createMerchant("unauth");
  const res = await refund(m.merchantId, { "idempotency-key": randomUUID() }, { transactionId: randomUUID() });
  assert.equal(res.statusCode, 401, res.body);

  const old = await app.inject({
    method: "POST",
    url: "/v1/refunds",
    headers: { authorization: `Bearer ${m.rawKey}` },
    payload: {},
  });
  assert.equal(old.statusCode, 404, old.body);
});

test("FP-300.5: the transaction detail and timeline show the refund (amount in fils, status after it)", async () => {
  const m = await createMerchant("timeline");
  const txnId = await capturedTransaction(m.rawKey, 10_000);
  const auth = { authorization: `Bearer ${m.rawKey}` };

  const first = await refund(m.merchantId, { ...auth, "idempotency-key": randomUUID() }, { transactionId: txnId, amountFils: 2_500 });
  assert.equal(first.statusCode, 200, first.body);
  const second = await refund(m.merchantId, { ...auth, "idempotency-key": randomUUID() }, { transactionId: txnId });
  assert.equal(second.statusCode, 200, second.body);

  const detail = await app.inject({ method: "GET", url: `/v1/transactions/${txnId}`, headers: auth });
  assert.equal(detail.statusCode, 200, detail.body);
  const txn = detail.json() as { status: string; capturedFils: number; refundedFils: number };
  assert.equal(txn.status, "refunded");
  assert.equal(txn.capturedFils, 10_000);
  assert.equal(txn.refundedFils, 10_000);

  const events = await app.inject({ method: "GET", url: `/v1/transactions/${txnId}/events`, headers: auth });
  assert.equal(events.statusCode, 200, events.body);
  const timeline = events.json() as { eventType: string; amountFils: number | null; metadata: Record<string, unknown> }[];
  const refundEvents = timeline.filter((e) => e.eventType === "refund_partial" || e.eventType === "refunded");
  assert.deepEqual(
    refundEvents.map((e) => [e.eventType, e.amountFils, e.metadata.transactionStatus]),
    [
      ["refund_partial", -2_500, "partially_refunded"],
      ["refunded", -7_500, "refunded"],
    ],
  );
  // The timeline sums to what is left with the merchant, to the fil.
  const net = timeline.reduce((sum, e) => sum + (e.amountFils ?? 0), 0);
  assert.equal(net, 0);
});
