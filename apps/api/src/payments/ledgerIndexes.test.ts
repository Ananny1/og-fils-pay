/**
 * CAP-3: the per-payment queries on ledger_entries and holds must be able to
 * use an index. Without one, every captured payment scans the whole ledger
 * (the deferred balance trigger runs once per leg), so the checkout gets
 * slower with every payment ever made. Requires a migrated DATABASE_URL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("ledgerIndexes.test.ts requires DATABASE_URL");
}

const HOT_QUERIES: Array<[string, string]> = [
  // db/migrations/0007 check_ledger_group_balance(), once per inserted leg
  ["ledger balance trigger", "SELECT amount_fils FROM ledger_entries WHERE entry_group_id = '00000000-0000-0000-0000-000000000000'"],
  // payments/discountAdjustment.ts, processRefund.ts
  ["ledger by transaction", "SELECT amount_fils FROM ledger_entries WHERE transaction_id = '00000000-0000-0000-0000-000000000000'"],
  // payments/capture.ts / void.ts hold release
  ["holds by transaction", "SELECT id FROM holds WHERE transaction_id = '00000000-0000-0000-0000-000000000000' AND status = 'active'"],
];

test("hot per-payment ledger/holds lookups can use an index (no forced sequential scan)", async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Tiny test tables would make the planner prefer a scan anyway; forbid
    // it so the plan shows whether an index exists at all.
    await client.query("SET LOCAL enable_seqscan = off");
    for (const [name, sql] of HOT_QUERIES) {
      const plan = await client.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`);
      const text = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
      assert.doesNotMatch(text, /Seq Scan/, `${name} has no usable index:\n${text}`);
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
