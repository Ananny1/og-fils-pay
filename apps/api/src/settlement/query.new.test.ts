/**
 * BUG-024: the settlement summary must equal the sum of capture events in
 * the window (what a batch would settle), also for multi-capture
 * transactions. Requires DATABASE_URL to point at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { getSettlementSummary } from "./query.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("query.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const pool = new Pool({ connectionString: databaseUrl, max: 5 });

test.after(async () => {
  await pool.end();
});

async function createMerchant(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Summary Multi-Capture ${randomUUID()}`],
  );
  return result.rows[0]!.id;
}

async function createCapturedTransaction(merchantId: string, captures: Array<{ fils: number; at: string }>) {
  const total = captures.reduce((sum, c) => sum + c.fils, 0);
  const txn = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', $2, $2, $3) RETURNING id`,
    [merchantId, total, `acqref_${randomUUID()}`],
  );
  const transactionId = txn.rows[0]!.id;
  for (const [i, c] of captures.entries()) {
    await pool.query(
      `INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, occurred_at)
       VALUES ($1, $2, $3, 'system', $4)`,
      [transactionId, i === captures.length - 1 ? "captured" : "partially_captured", c.fils, c.at],
    );
  }
  return transactionId;
}

test("BUG-024: a transaction captured in three parts is counted once at its captured total, not three times", async () => {
  const merchantId = await createMerchant();
  await createCapturedTransaction(merchantId, [
    { fils: 3_000, at: "2026-06-10T08:00:00Z" },
    { fils: 3_000, at: "2026-06-10T09:00:00Z" },
    { fils: 4_000, at: "2026-06-10T10:00:00Z" },
  ]);
  await createCapturedTransaction(merchantId, [{ fils: 1_250, at: "2026-06-10T11:00:00Z" }]);

  const summary = await getSettlementSummary(pool, { merchantId, from: "2026-06-10", to: "2026-06-11" });

  assert.equal(summary.transactionCount, 2);
  assert.equal(summary.totalCapturedFils, 11_250);
});

test("BUG-024: only the capture events inside the window count (a capture split across two business days)", async () => {
  const merchantId = await createMerchant();
  await createCapturedTransaction(merchantId, [
    { fils: 3_000, at: "2026-06-10T08:00:00Z" },
    // 22:00 UTC = 01:00 on 11 June in Bahrain: next business day
    { fils: 7_000, at: "2026-06-10T22:00:00Z" },
  ]);

  const day1 = await getSettlementSummary(pool, { merchantId, from: "2026-06-10", to: "2026-06-11" });
  const day2 = await getSettlementSummary(pool, { merchantId, from: "2026-06-11", to: "2026-06-12" });

  assert.equal(day1.totalCapturedFils, 3_000);
  assert.equal(day2.totalCapturedFils, 7_000);
});
