/**
 * BUG-110: the refund_merchant_summary materialized view (0072) joined
 * transactions on t.id = r.id (the refund's own id), so no refund ever matched
 * and the admin refund summary was always empty. Runs in a rolled-back
 * transaction. Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("refund_merchant_summary.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

test.after(async () => {
  await pool.end();
});

test("a succeeded refund shows up in refund_merchant_summary with its transaction's captured amount", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const m = await client.query<{ id: string }>(
      `INSERT INTO merchants (display_name) VALUES ('BUG-110 shop') RETURNING id`,
    );
    const merchantId = m.rows[0]!.id;
    const t = await client.query<{ id: string }>(
      `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
       VALUES ($1, 'captured', 10000, 10000, 'bug110-txn') RETURNING id`,
      [merchantId],
    );
    await client.query(
      `INSERT INTO refunds (transaction_id, merchant_id, amount_fils, fee_reversed_fils, status,
                            acquirer_reference, created_by_type, created_by_id)
       VALUES ($1, $2, 3000, 75, 'succeeded', 'bug110-rf', 'merchant_session', gen_random_uuid())`,
      [t.rows[0]!.id, merchantId],
    );
    await client.query(`REFRESH MATERIALIZED VIEW refund_merchant_summary`);

    const rows = await client.query<{
      refund_count: string;
      total_refunded_fils: string;
      total_fee_reversed_fils: string;
      original_captured_fils: string;
    }>(
      `SELECT refund_count, total_refunded_fils, total_fee_reversed_fils, original_captured_fils
         FROM refund_merchant_summary WHERE merchant_id = $1`,
      [merchantId],
    );
    assert.equal(rows.rows.length, 1, "the refund must appear in the summary");
    assert.equal(Number(rows.rows[0]!.refund_count), 1);
    assert.equal(Number(rows.rows[0]!.total_refunded_fils), 3000);
    assert.equal(Number(rows.rows[0]!.total_fee_reversed_fils), 75);
    assert.equal(Number(rows.rows[0]!.original_captured_fils), 10000);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
