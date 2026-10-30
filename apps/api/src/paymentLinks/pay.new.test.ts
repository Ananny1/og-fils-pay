/**
 * Regression tests for the public checkout path (payment link -> pay ->
 * authorize -> capture -> link paid). Real, migrated Postgres; no DB
 * mocking. Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { setTimeout as sleep } from "node:timers/promises";
import { createAcquirerSimulator } from "../acquirer/simulator.js";
import type { AcquirerSimulator } from "../acquirer/types.js";
import { payPaymentLink } from "./pay.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("pay.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  PAYMENT_LINK_RESERVATION_TIMEOUT_SECONDS: "60",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const APPROVED_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

async function createMerchantWithLink(amountFils = 4_750, mdrBps = 250, discountBps = 0) {
  const merchantResult = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, negotiated_discount_bps) VALUES ($1, $2, $3) RETURNING id`,
    [`Checkout Test ${randomUUID()}`, mdrBps, discountBps],
  );
  const merchantId = merchantResult.rows[0]!.id;
  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused-in-these-tests') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: userResult.rows[0]!.id, label: "checkout" });
  const res = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: { authorization: `Bearer ${issued.rawKey}` },
    payload: { amountFils, reference: "order-1", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.equal(res.statusCode, 201, res.body);
  const link = res.json() as { id: string; token: string };
  return { merchantId, link };
}

// ---------------------------------------------------------------- BUG-004

test("BUG-004: an expired link cannot be paid by sending an old submittedAt", async () => {
  const { link } = await createMerchantWithLink();
  await pool.query(`UPDATE payment_links SET expires_at = now() - interval '1 hour' WHERE id = $1`, [link.id]);

  const res = await app.inject({
    method: "POST",
    url: `/v1/payment-links/${link.token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: APPROVED_CARD, submittedAt: new Date(Date.now() - 86_400_000).toISOString() },
  });
  assert.equal(res.statusCode, 410, res.body);
  assert.equal(res.json().error, "payment_link_expired");

  const row = await pool.query<{ status: string }>(`SELECT status FROM payment_links WHERE id = $1`, [link.id]);
  assert.equal(row.rows[0]!.status, "active");
  const txns = await pool.query(`SELECT 1 FROM transactions t JOIN payment_links l ON l.merchant_id = t.merchant_id WHERE l.id = $1`, [
    link.id,
  ]);
  assert.equal(txns.rowCount, 0, "no card may be authorized against an expired link");
});

// ---------------------------------------------------------------- BUG-005

/**
 * Wraps the real simulator so one chosen call is slow (the "big basket /
 * 3DS step-up" capture from the 2026-05-14 incident) while every other
 * call is instant.
 */
function slowAcquirer(slow: { op: "authorize" | "capture"; callIndex: number; ms: number }): AcquirerSimulator {
  const inner = createAcquirerSimulator(config);
  const calls = { authorize: 0, capture: 0 };
  const delay = async (op: "authorize" | "capture") => {
    const index = calls[op]++;
    if (op === slow.op && index === slow.callIndex) await sleep(slow.ms);
  };
  return {
    async authorize(req) {
      await delay("authorize");
      return inner.authorize(req);
    },
    async capture(req) {
      await delay("capture");
      return inner.capture(req);
    },
    refund: (req) => inner.refund(req),
  };
}

async function capturedTransactions(merchantId: string) {
  const r = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM transactions WHERE merchant_id = $1 AND captured_fils > 0`,
    [merchantId],
  );
  return r.rows;
}

const SHORT_RESERVATION = { paymentLinkReservationTimeoutSeconds: 1 };

test("BUG-005: slow first capture outlives the reservation -> second payer cannot also be charged", async () => {
  const { merchantId, link } = await createMerchantWithLink(12_500);
  const acquirer = slowAcquirer({ op: "capture", callIndex: 0, ms: 2_500 });

  const first = payPaymentLink(pool, acquirer, SHORT_RESERVATION, {
    token: link.token,
    card: APPROVED_CARD,
    idempotencyKey: randomUUID(),
  });
  await sleep(1_300); // first payer's reservation (1 s) has run out; its capture is still in flight
  const second = payPaymentLink(pool, acquirer, SHORT_RESERVATION, {
    token: link.token,
    card: APPROVED_CARD,
    idempotencyKey: randomUUID(),
  });
  const results = await Promise.all([first, second]);

  const captured = await capturedTransactions(merchantId);
  assert.equal(captured.length, 1, `exactly one capture per link, got ${captured.length}`);
  assert.deepEqual(
    results.map((r) => r.statusCode).sort(),
    [200, 409],
    `one payer succeeds, the other gets a clean 409: ${JSON.stringify(results)}`,
  );
  const ok = results.find((r) => r.statusCode === 200)!.body as { transactionId: string };
  const linkRow = await pool.query<{ status: string; transaction_id: string }>(
    `SELECT status, transaction_id FROM payment_links WHERE id = $1`,
    [link.id],
  );
  assert.equal(linkRow.rows[0]!.status, "paid");
  assert.equal(linkRow.rows[0]!.transaction_id, ok.transactionId);
  assert.equal(captured[0]!.id, ok.transactionId);
});

test("BUG-005: slow first authorize outlives the reservation -> late payer is refused and its hold voided", async () => {
  const { merchantId, link } = await createMerchantWithLink(8_000);
  const acquirer = slowAcquirer({ op: "authorize", callIndex: 0, ms: 2_500 });

  const first = payPaymentLink(pool, acquirer, SHORT_RESERVATION, {
    token: link.token,
    card: APPROVED_CARD,
    idempotencyKey: randomUUID(),
  });
  await sleep(1_300);
  const second = await payPaymentLink(pool, acquirer, SHORT_RESERVATION, {
    token: link.token,
    card: APPROVED_CARD,
    idempotencyKey: randomUUID(),
  });
  assert.equal(second.statusCode, 200, JSON.stringify(second.body));
  const late = await first;
  assert.equal(late.statusCode, 409, JSON.stringify(late.body));

  const captured = await capturedTransactions(merchantId);
  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.id, (second.body as { transactionId: string }).transactionId);

  // The late payer's authorization must not leave a hold on their card.
  const leftover = await pool.query<{ status: string; hold_status: string }>(
    `SELECT t.status, h.status AS hold_status FROM transactions t JOIN holds h ON h.transaction_id = t.id
      WHERE t.merchant_id = $1 AND t.captured_fils = 0`,
    [merchantId],
  );
  assert.equal(leftover.rows.length, 1);
  assert.equal(leftover.rows[0]!.status, "voided");
  assert.equal(leftover.rows[0]!.hold_status, "released");
});

test("BUG-005: the database itself refuses a second captured transaction for one link", async () => {
  const { merchantId, link } = await createMerchantWithLink(1_000);
  const insert = () =>
    pool.query(
      `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference, payment_link_id)
       VALUES ($1, 'captured', 1000, 1000, $2, $3)`,
      [merchantId, `acq_${randomUUID()}`, link.id],
    );
  await insert();
  await assert.rejects(insert, /uq_transactions_payment_link_captured/);
});
