/**
 * "Explain my payout": the numbers Claude is given are computed here in
 * integer fils, and a merchant can never get another merchant's batch.
 * The DB tests need DATABASE_URL (a real, migrated Postgres). No Claude calls.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool } from "pg";
import { buildPayoutFacts, loadPayoutFacts } from "./payoutExplanation.js";

const base = {
  batchId: "b1",
  batchDate: "2026-08-31",
  status: "closed",
  closedAt: "2026-08-31T21:05:00.000Z",
  paidAt: null,
  paymentCount: 42,
  partiallyCapturedCount: 3,
};

test("formats the seed's 31 Aug batch exactly, fee rate from integer basis points", () => {
  const f = buildPayoutFacts({
    ...base,
    grossFils: 7_326_913,
    feeFils: 183_174,
    netPayoutFils: 7_143_739,
    previousGrossFils: [],
  });
  assert.equal(f.grossBhd, "7326.913 BHD");
  assert.equal(f.feeBhd, "183.174 BHD");
  assert.equal(f.netPayoutBhd, "7143.739 BHD");
  // 183174 / 7326913 = 0.025000...  -> 250 bps -> "2.50%"
  assert.equal(f.effectiveFeeRate, "2.50%");
  assert.equal(f.comparison, null);
  assert.match(f.statusMeaning, /not been marked as sent/);
  // Bahrain is UTC+3: 21:05Z on 31 Aug is 00:05 on 1 Sep.
  assert.match(f.closedAtBahrain ?? "", /1 Sept? 2026, 00:05/);
});

test("comparison uses the integer average of earlier days and a rounded whole percent", () => {
  const f = buildPayoutFacts({
    ...base,
    grossFils: 1_500_000,
    feeFils: 37_500,
    netPayoutFils: 1_462_500,
    previousGrossFils: [1_000_000, 1_000_001, 999_999],
  });
  assert.deepEqual(f.comparison, { previousDays: 3, averageGrossBhd: "1000.000 BHD", changePercent: 50 });
});

test("an empty day has no fee rate instead of dividing by zero", () => {
  const f = buildPayoutFacts({ ...base, status: "open", grossFils: 0, feeFils: 0, netPayoutFils: 0, previousGrossFils: [] });
  assert.equal(f.effectiveFeeRate, null);
  assert.equal(f.netPayoutBhd, "0.000 BHD");
});

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  after(async () => {
    await pool.end();
  });

  test("loadPayoutFacts returns null for another merchant's batch", async () => {
    const mk = async () =>
      (await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [`payout test ${randomUUID()}`])).rows[0]!.id;
    const owner = await mk();
    const other = await mk();
    const batch = await pool.query<{ id: string }>(
      `INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils)
       VALUES ($1, '2026-08-31', 'closed', 100000, 2500, 97500) RETURNING id`,
      [owner],
    );
    const batchId = batch.rows[0]!.id;

    const own = await loadPayoutFacts(pool, owner, batchId);
    assert.equal(own?.netPayoutBhd, "97.500 BHD");
    assert.equal(await loadPayoutFacts(pool, other, batchId), null);
  });
}
