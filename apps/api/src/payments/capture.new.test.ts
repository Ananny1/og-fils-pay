/**
 * Regression tests for captureTransaction fee and metric logic. Real,
 * migrated Postgres. Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { applyRateFils, toFils } from "@filspay/money";
import { createAcquirerSimulator } from "../acquirer/simulator.js";
import { loadConfig } from "../config.js";
import { recordKycReview } from "../onboarding/review.js";
import { authorizeTransaction } from "./authorize.js";
import { captureTransaction } from "./capture.js";
import { applyCaptureDiscountAdjustment } from "./discountAdjustment.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("capture.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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
const acquirer = createAcquirerSimulator(config);

test.after(async () => {
  await pool.end();
});

const APPROVED_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

async function authorizedTransaction(amountFils: number, mdrBps: number, discountBps: number) {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, negotiated_discount_bps) VALUES ($1, $2, $3) RETURNING id`,
    [`Capture Fee Test ${randomUUID()}`, mdrBps, discountBps],
  );
  const merchantId = m.rows[0]!.id;
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const auth = await authorizeTransaction(pool, acquirer, {
    merchantId,
    amountFils: toFils(amountFils),
    card: APPROVED_CARD,
    idempotencyKey: randomUUID(),
  });
  assert.equal(auth.statusCode, 201, JSON.stringify(auth.body));
  return { merchantId, transactionId: (auth.body as { id: string }).id };
}

/** What apps/settlement's ComputeSettlementFee charges for one capture event. */
async function settlementFee(amountFils: number, mdrBps: number, discountBps: number): Promise<number> {
  const stats = await pool.query<{ total_processed_fils: string }>(`SELECT total_processed_fils FROM platform_stats WHERE id = 1`);
  const bonus = Number(stats.rows[0]?.total_processed_fils ?? 0) >= 2_000_000_000 ? 15 : 0;
  const amount = toFils(amountFils);
  return applyRateFils(toFils(amount - applyRateFils(amount, discountBps)), Math.max(0, mdrBps - bonus));
}

/** Net fee the ledger charged the merchant for this transaction. */
async function ledgerNetFee(transactionId: string): Promise<number> {
  const r = await pool.query<{ net: string }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_fils ELSE -amount_fils END), 0) AS net
       FROM ledger_entries
      WHERE transaction_id = $1 AND account_id = 'merchant_payable'
        AND description IN ('capture: MDR fee', 'capture: negotiated discount adjustment')`,
    [transactionId],
  );
  return Number(r.rows[0]!.net);
}

// ---------------------------------------------------------------- BUG-036

test("BUG-036: capture charges the same fee settlement will (discount off the amount, then MDR)", async () => {
  // 602 fils, 275 bps MDR, 12.5% negotiated discount. Settlement: 602 - 75 = 527; 527 @ 275 bps = 14.
  const { merchantId, transactionId } = await authorizedTransaction(602, 275, 1250);
  const cap = await captureTransaction(pool, acquirer, {
    transactionId,
    merchantId,
    idempotencyKey: randomUUID(),
    actor: { type: "system", id: transactionId },
  });
  assert.equal(cap.statusCode, 200, JSON.stringify(cap.body));

  // Payment-link checkout path: nothing runs after capture.
  assert.equal(await ledgerNetFee(transactionId), await settlementFee(602, 275, 1250));
});

test("BUG-036: the transactions route's post-capture adjustment does not discount a second time", async () => {
  const { merchantId, transactionId } = await authorizedTransaction(602, 275, 1250);
  const cap = await captureTransaction(pool, acquirer, {
    transactionId,
    merchantId,
    idempotencyKey: randomUUID(),
    actor: { type: "system", id: transactionId },
  });
  assert.equal(cap.statusCode, 200, JSON.stringify(cap.body));
  await applyCaptureDiscountAdjustment(pool, { merchantId, transactionId }); // what routes/transactions.ts does

  assert.equal(await ledgerNetFee(transactionId), await settlementFee(602, 275, 1250));
});
