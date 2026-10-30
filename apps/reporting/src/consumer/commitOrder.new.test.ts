/**
 * BUG-096: outbox ids come from a sequence, but transactions commit in any
 * order. An event whose transaction commits AFTER a later-id event was
 * already consumed must still be applied, never skipped forever.
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

test("an event that commits after a higher-id event was consumed is still applied", async () => {
  await drain();
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`commit-order test ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const capture = (fils: number) => ({
    eventType: "transaction.captured" as const,
    aggregateType: "transaction" as const,
    aggregateId: randomUUID(),
    payload: { merchantId, amountCapturedFils: fils, feeFils: 0, newStatus: "captured", capturedTotalFils: fils },
  });

  // A slow capture: its transaction takes the lower outbox id but has not committed yet.
  const slow = await pool.connect();
  try {
    await slow.query("BEGIN");
    const slowEvent = await enqueueEvent(slow, capture(1_000));
    // A fast capture takes the next id and commits straight away.
    const fastEvent = await enqueueEvent(pool, capture(2_000));
    assert.ok(slowEvent.id < fastEvent.id);

    await runConsumerPass(pool, config); // the worker runs while the slow one is still open
    await slow.query("COMMIT");
  } finally {
    slow.release();
  }
  await drain();

  const rows = await pool.query(
    `SELECT SUM(captured_count)::int AS n, SUM(captured_gross_fils)::bigint AS gross FROM merchant_daily_volume WHERE merchant_id = $1`,
    [merchantId],
  );
  assert.equal(rows.rows[0].n, 2, "both captures must reach the rollup");
  assert.equal(Number(rows.rows[0].gross), 3_000);
});
