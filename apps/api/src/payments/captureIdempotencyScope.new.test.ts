/**
 * BUG-073: a capture Idempotency-Key reused on a different transaction must
 * be rejected, never answered with the first transaction's cached capture.
 * Real, migrated Postgres. Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { toFils } from "@filspay/money";
import { createAcquirerSimulator } from "../acquirer/simulator.js";
import { loadConfig } from "../config.js";
import { recordKycReview } from "../onboarding/review.js";
import { UnprocessableEntityError } from "../lib/errors.js";
import { authorizeTransaction } from "./authorize.js";
import { captureTransaction } from "./capture.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("captureIdempotencyScope.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

async function authorize(merchantId: string, amountFils: number): Promise<string> {
  const auth = await authorizeTransaction(pool, acquirer, {
    merchantId,
    amountFils: toFils(amountFils),
    card: APPROVED_CARD,
    idempotencyKey: randomUUID(),
  });
  assert.equal(auth.statusCode, 201, JSON.stringify(auth.body));
  return (auth.body as { id: string }).id;
}

test("BUG-073: the same capture Idempotency-Key on a second transaction is rejected, not replayed", async () => {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 200) RETURNING id`,
    [`Capture Key Scope ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });

  const txnA = await authorize(merchantId, 5_000);
  const txnB = await authorize(merchantId, 5_000);
  const key = randomUUID();
  const actor = { type: "merchant_session" as const, id: randomUUID() };

  const first = await captureTransaction(pool, acquirer, { transactionId: txnA, merchantId, idempotencyKey: key, actor });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));

  // Same key, different transaction: before the fix this returned 200 with
  // transaction A's body, and B stayed uncaptured.
  await assert.rejects(
    captureTransaction(pool, acquirer, { transactionId: txnB, merchantId, idempotencyKey: key, actor }),
    (err: unknown) => err instanceof UnprocessableEntityError && err.code === "idempotency_key_reused",
  );

  const b = await pool.query<{ status: string }>(`SELECT status FROM transactions WHERE id = $1`, [txnB]);
  assert.equal(b.rows[0]!.status, "authorized");

  // A true retry of the first request still replays.
  const replay = await captureTransaction(pool, acquirer, { transactionId: txnA, merchantId, idempotencyKey: key, actor });
  assert.equal(replay.statusCode, 200);
  assert.equal((replay.body as { id: string }).id, txnA);
});
