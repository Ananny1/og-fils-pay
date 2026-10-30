/**
 * BUG-027: the March sweep against a real, migrated Postgres. Running it
 * twice must post once; legs must follow ADR-0002; the window is the
 * Bahrain calendar month. Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import * as sweep from "./reconcile_march.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("reconcile_march.sweep.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const pool = new Pool({ connectionString: databaseUrl, max: 3 });

test.after(async () => {
  await pool.end();
});

async function createMerchant(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, status, test_mode)
     VALUES ($1, 250, 'active', false) RETURNING id`,
    [`march-sweep-${randomUUID()}`],
  );
  return result.rows[0]!.id;
}

type PostFn = (
  client: Pool,
  merchant: { merchantId: string; lineCount: number; residueFils: number },
  now: Date,
) => Promise<unknown>;

test("BUG-027: running the sweep twice posts the residue once, on the ADR-0002 accounts", async () => {
  const merchantId = await createMerchant();
  const post = (sweep as unknown as { postResidueCorrection?: PostFn }).postResidueCorrection;
  assert.equal(typeof post, "function", "postResidueCorrection must be exported to be testable");

  const merchant = { merchantId, lineCount: 2, residueFils: 13 };
  await post!(pool, merchant, new Date());
  await post!(pool, merchant, new Date());

  const legs = await pool.query<{ account_id: string; direction: string; amount_fils: string }>(
    `SELECT account_id, direction, amount_fils FROM ledger_entries WHERE merchant_id = $1 ORDER BY account_id`,
    [merchantId],
  );
  assert.deepEqual(
    legs.rows.map((r) => [r.account_id, r.direction, Number(r.amount_fils)]),
    [
      ["card_scheme_clearing", "credit", 13],
      ["scheme_rounding_residue", "debit", 13],
    ],
  );
});

test("BUG-027: the March window is the Bahrain month (21:00 UTC boundaries)", () => {
  const { start, end } = sweep.monthBounds(2026, 3);
  assert.equal(start.toISOString(), "2026-02-28T21:00:00.000Z");
  assert.equal(end.toISOString(), "2026-03-31T21:00:00.000Z");
});
