/**
 * BUG-006: a redelivered acquirer callback (same callbackId) must be
 * recorded once, however many times or however concurrently it arrives.
 * Requires DATABASE_URL to point at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { applyAcquirerCallback, type AcquirerCallbackInput } from "./callbacks.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("callbacks.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const pool = new Pool({ connectionString: databaseUrl, max: 10 });

test.after(async () => {
  await pool.end();
});

async function createTransaction(): Promise<string> {
  const merchantResult = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, $2) RETURNING id`,
    [`Acquirer Callback Dedupe Merchant ${randomUUID()}`, 250],
  );
  const txnResult = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 50000, 50000, $2)
     RETURNING id`,
    [merchantResult.rows[0]!.id, `acqref_${randomUUID()}`],
  );
  return txnResult.rows[0]!.id;
}

function callbackFor(transactionId: string, callbackId: string): AcquirerCallbackInput {
  return {
    callbackId,
    type: "fraud_review.completed",
    transactionId,
    occurredAt: "2026-09-16T10:00:00.000Z",
    outcome: "confirmed_fraud",
    note: "Card testing pattern.",
  };
}

async function noteCount(callbackId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM acquirer_callback_notes WHERE callback_id = $1`,
    [callbackId],
  );
  return Number(result.rows[0]!.count);
}

test("BUG-006: the same callback delivered twice is recorded once, and the redelivery still succeeds", async () => {
  const transactionId = await createTransaction();
  const callbackId = `acqcb_${randomUUID()}`;

  await applyAcquirerCallback(pool, callbackFor(transactionId, callbackId));
  await applyAcquirerCallback(pool, callbackFor(transactionId, callbackId));

  assert.equal(await noteCount(callbackId), 1);
});

test("BUG-006: concurrent redeliveries of one callback are recorded once", async () => {
  const transactionId = await createTransaction();
  const callbackId = `acqcb_${randomUUID()}`;

  await Promise.all(
    Array.from({ length: 5 }, () => applyAcquirerCallback(pool, callbackFor(transactionId, callbackId))),
  );

  assert.equal(await noteCount(callbackId), 1);
});

test("BUG-006: distinct callbacks for the same transaction are all recorded", async () => {
  const transactionId = await createTransaction();
  const a = `acqcb_${randomUUID()}`;
  const b = `acqcb_${randomUUID()}`;

  await applyAcquirerCallback(pool, callbackFor(transactionId, a));
  await applyAcquirerCallback(pool, callbackFor(transactionId, b));

  assert.equal(await noteCount(a), 1);
  assert.equal(await noteCount(b), 1);
});
