/**
 * A malformed outbox event (no merchantId) can never be applied, no matter
 * how many times it is retried. It must be skipped so it does not freeze
 * every rollup behind it. Requires DATABASE_URL (a real, migrated Postgres).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { enqueueEvent } from "@filspay/events";
import { runConsumerPass, CONSUMER_NAME } from "./runConsumerPass.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("poisonEvent.new.test.ts requires DATABASE_URL");

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const config = { consumerBatchLimit: 500 };
test.after(async () => {
  await pool.end();
});

async function getCursor(): Promise<bigint> {
  const r = await pool.query<{ last_processed_id: string }>(
    `SELECT last_processed_id FROM reporting_outbox_cursor WHERE consumer_name = $1`,
    [CONSUMER_NAME],
  );
  return r.rows[0] ? BigInt(r.rows[0].last_processed_id) : 0n;
}

test("an event with no merchantId is skipped: the pass succeeds, the watermark moves past it, and later events still apply", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`poison-event test ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;

  const poison = await enqueueEvent(pool, {
    eventType: "transaction.captured",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: {},
  });
  const good = await enqueueEvent(pool, {
    eventType: "transaction.captured",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: { merchantId, amountCapturedFils: 4_755, feeFils: 107, newStatus: "captured", capturedTotalFils: 4_755 },
  });

  // Drain: a pass must never throw because of the poison event.
  for (let i = 0; i < 20 && (await getCursor()) < good.id; i++) {
    await runConsumerPass(pool, config);
  }

  assert.ok((await getCursor()) >= good.id, "watermark moved past both the poison event and the good one");
  assert.ok(poison.id < good.id);
  const rows = await pool.query(`SELECT captured_count, captured_gross_fils FROM merchant_daily_volume WHERE merchant_id = $1`, [
    merchantId,
  ]);
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].captured_count, 1);
  assert.equal(Number(rows.rows[0].captured_gross_fils), 4_755);
});
