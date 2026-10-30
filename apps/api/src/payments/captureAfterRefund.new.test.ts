/**
 * BUG-084: capturing the rest of a sale after a partial refund must not
 * reset its status to plain "captured". Real Postgres; requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { toFils } from "@filspay/money";
import { createAcquirerSimulator } from "../acquirer/simulator.js";
import { loadConfig } from "../config.js";
import { recordKycReview } from "../onboarding/review.js";
import { authorizeTransaction } from "./authorize.js";
import { captureTransaction } from "./capture.js";
import { processRefund } from "./processRefund.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("captureAfterRefund.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

test("BUG-084: capturing the remainder after a partial refund leaves the sale partially_refunded", async () => {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 200) RETURNING id`,
    [`Capture After Refund ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const actor = { type: "merchant_session" as const, id: randomUUID() };

  const auth = await authorizeTransaction(pool, acquirer, {
    merchantId,
    amountFils: toFils(10_000),
    card: APPROVED_CARD,
    idempotencyKey: randomUUID(),
  });
  assert.equal(auth.statusCode, 201);
  const transactionId = (auth.body as { id: string }).id;

  const c1 = await captureTransaction(pool, acquirer, {
    transactionId, merchantId, amountFils: toFils(5_000), idempotencyKey: randomUUID(), actor,
  });
  assert.equal(c1.statusCode, 200);
  const r = await processRefund(pool, acquirer, {
    transactionId, merchantId, amountFils: toFils(1_000), idempotencyKey: randomUUID(), actor,
  });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));

  const c2 = await captureTransaction(pool, acquirer, { transactionId, merchantId, idempotencyKey: randomUUID(), actor });
  assert.equal(c2.statusCode, 200, JSON.stringify(c2.body));

  const row = await pool.query<{ status: string; captured_fils: string; refunded_fils: string }>(
    `SELECT status, captured_fils, refunded_fils FROM transactions WHERE id = $1`,
    [transactionId],
  );
  assert.equal(Number(row.rows[0]!.captured_fils), 10_000);
  assert.equal(Number(row.rows[0]!.refunded_fils), 1_000);
  // Before the fix: 'captured', as if the 1.000 BD refund never happened.
  assert.equal(row.rows[0]!.status, "partially_refunded");

  const hold = await pool.query<{ status: string }>(`SELECT status FROM holds WHERE transaction_id = $1`, [transactionId]);
  assert.equal(hold.rows[0]!.status, "released");
  const ev = await pool.query<{ event_type: string }>(
    `SELECT event_type FROM transaction_events WHERE transaction_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    [transactionId],
  );
  assert.equal(ev.rows[0]!.event_type, "captured");
});
