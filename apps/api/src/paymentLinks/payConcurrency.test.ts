/**
 * BUG-005: a payment link must never be charged twice, even when the
 * acquirer is slower than the reservation timeout (incident 2026-05-14).
 * Real, migrated Postgres; a wrapped simulator makes capture slow.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { toFils } from "@filspay/money";
import { loadConfig } from "../config.js";
import { createAcquirerSimulator } from "../acquirer/simulator.js";
import type { AcquirerSimulator } from "../acquirer/types.js";
import { recordKycReview } from "../onboarding/review.js";
import { payPaymentLink } from "./pay.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("payConcurrency.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  PAYMENT_LINK_RESERVATION_TIMEOUT_SECONDS: "1",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 10 });
test.after(async () => {
  await pool.end();
});

const APPROVED_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Real simulator, but every capture takes `captureDelayMs` (longer than the 1 s reservation timeout). */
function slowCaptureAcquirer(captureDelayMs: number): AcquirerSimulator {
  const inner = createAcquirerSimulator(config);
  return {
    authorize: (req) => inner.authorize(req),
    capture: async (req) => {
      await sleep(captureDelayMs);
      return inner.capture(req);
    },
    refund: (req) => inner.refund(req),
  };
}

async function createActiveLink(amountFils: number) {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Test Merchant paylink-race ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const token = `plink_test_${randomUUID()}`;
  await pool.query(
    `INSERT INTO payment_links (merchant_id, token, amount_fils, expires_at, created_by_type, created_by_id)
     VALUES ($1, $2, $3, now() + interval '1 hour', 'merchant_api_key', gen_random_uuid())`,
    [merchantId, token, toFils(amountFils)],
  );
  return { merchantId, token };
}

test("slow capture past the reservation timeout + a second payer -> exactly one charge", async () => {
  const { merchantId, token } = await createActiveLink(2_500);
  const acquirer = slowCaptureAcquirer(2_500);
  const cfg = { paymentLinkReservationTimeoutSeconds: config.paymentLinkReservationTimeoutSeconds };

  const first = payPaymentLink(pool, acquirer, cfg, { token, card: APPROVED_CARD, idempotencyKey: randomUUID() });
  // Second payer arrives after the first one's reservation has gone stale.
  await sleep(1_500);
  const second = payPaymentLink(pool, acquirer, cfg, { token, card: APPROVED_CARD, idempotencyKey: randomUUID() });

  const results = await Promise.all([first, second]);
  const ok = results.filter((r) => r.statusCode === 200);
  assert.equal(ok.length, 1, `exactly one payer is told "paid": ${JSON.stringify(results)}`);

  const captured = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM transactions WHERE merchant_id = $1 AND captured_fils > 0`,
    [merchantId],
  );
  assert.equal(captured.rows[0]!.c, 1, "the card was captured exactly once");

  const link = await pool.query<{ status: string; transaction_id: string }>(
    `SELECT status, transaction_id FROM payment_links WHERE token = $1`,
    [token],
  );
  assert.equal(link.rows[0]!.status, "paid");
  assert.equal(link.rows[0]!.transaction_id, (ok[0]!.body as { transactionId: string }).transactionId);
});
