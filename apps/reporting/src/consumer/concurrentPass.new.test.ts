/**
 * BUG-130: two consumer passes running at the same time (a `catch-up` run
 * beside the live worker) must never apply the same outbox event twice.
 * Requires DATABASE_URL (a real, migrated Postgres).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { enqueueEvent } from "@filspay/events";
import { runConsumerPass } from "./runConsumerPass.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const config = { consumerBatchLimit: 500 };
test.after(async () => {
  await pool.end();
});

async function drain(): Promise<void> {
  while ((await runConsumerPass(pool, config)).processedCount > 0) {
    /* keep going */
  }
}

test("two concurrent passes apply one captured event exactly once", async () => {
  await drain(); // start from a caught-up watermark
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`concurrent-pass test ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const volumeDate = "2026-01-05";
  // Pre-create the rollup row so a test-held row lock can make both passes
  // wait at the same point (after they have read the watermark).
  await pool.query(
    `INSERT INTO merchant_daily_volume (merchant_id, volume_date, captured_count, captured_gross_fils, last_updated_at)
     VALUES ($1, $2, 0, 0, now())`,
    [merchantId, volumeDate],
  );
  const ev = await enqueueEvent(pool, {
    eventType: "transaction.captured",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: { merchantId, amountCapturedFils: 1_000, feeFils: 25, newStatus: "captured", capturedTotalFils: 1_000 },
  });
  await pool.query(`UPDATE outbox_events SET created_at = '2026-01-05T10:00:00Z' WHERE id = $1`, [ev.id.toString()]);

  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query(`SELECT 1 FROM merchant_daily_volume WHERE merchant_id = $1 FOR UPDATE`, [merchantId]);
    const a = runConsumerPass(pool, config);
    const b = runConsumerPass(pool, config);
    await new Promise((r) => setTimeout(r, 500)); // both passes are now waiting
    await blocker.query("COMMIT");
    await Promise.all([a, b]);
  } finally {
    blocker.release();
  }

  const rows = await pool.query(
    `SELECT captured_count, captured_gross_fils FROM merchant_daily_volume WHERE merchant_id = $1 AND volume_date = $2`,
    [merchantId, volumeDate],
  );
  assert.equal(rows.rows[0].captured_count, 1, "the event must be counted once, not once per pass");
  assert.equal(Number(rows.rows[0].captured_gross_fils), 1_000);
});
