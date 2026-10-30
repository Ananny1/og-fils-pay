/**
 * BUG-026: the "current rate" shown to staff must be the rate payments are
 * charged at right now — the same answer getEffectiveMdrBps gives capture.
 * Requires DATABASE_URL to point at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { getCurrentFeeScheduleForDisplay } from "./currentFeeScheduleDisplay.js";
import { getEffectiveMdrBps } from "./feeSchedule.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("currentFeeScheduleDisplay.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const pool = new Pool({ connectionString: databaseUrl, max: 5 });

test.after(async () => {
  await pool.end();
});

async function insertMerchant(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Fee Display Match ${randomUUID()}`],
  );
  return result.rows[0]!.id;
}

async function insertSchedule(merchantId: string, mdrBps: number, effectiveFrom: string, createdAt: string) {
  await pool.query(
    `INSERT INTO fee_schedules (merchant_id, mdr_bps, effective_from, created_at) VALUES ($1, $2, $3, $4)`,
    [merchantId, mdrBps, effectiveFrom, createdAt],
  );
}

async function chargedNow(merchantId: string): Promise<number> {
  const client = await pool.connect();
  try {
    return await getEffectiveMdrBps(client, merchantId, new Date(), 250);
  } finally {
    client.release();
  }
}

test("BUG-026: a backdated correction entered later does not replace the rate in effect now (225, not 245)", async () => {
  const merchantId = await insertMerchant();
  await insertSchedule(merchantId, 225, "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
  await insertSchedule(merchantId, 245, "2026-03-01T00:00:00Z", "2026-08-15T00:00:00Z");

  const shown = await getCurrentFeeScheduleForDisplay(pool, merchantId);
  assert.equal(shown?.mdrBps, 225);
  assert.equal(shown?.mdrBps, await chargedNow(merchantId));
});

test("BUG-026: a schedule that starts in the future is not shown as current", async () => {
  const merchantId = await insertMerchant();
  await insertSchedule(merchantId, 200, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
  await insertSchedule(merchantId, 150, "2099-01-01T00:00:00Z", new Date().toISOString());

  const shown = await getCurrentFeeScheduleForDisplay(pool, merchantId);
  assert.equal(shown?.mdrBps, 200);
  assert.equal(shown?.mdrBps, await chargedNow(merchantId));
});
