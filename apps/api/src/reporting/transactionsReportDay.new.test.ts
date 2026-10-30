/**
 * BUG-089: a report filter with plain dates ("from": "2026-06-02",
 * "to": "2026-06-03") must cover the Bahrain business day (21:00 UTC to
 * 21:00 UTC). Before the fix the dates went to Postgres as-is and were read
 * as UTC midnight, so a payment at 01:00 Bahrain was reported on the
 * previous day and one at 22:00 Bahrain on the next.
 * Requires DATABASE_URL (migrated Postgres, server timezone UTC as in Docker).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { runTransactionsReport } from "./transactionsReportQuery.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("transactionsReportDay.new.test.ts requires DATABASE_URL");

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
test.after(async () => {
  await pool.end();
});

test("BUG-089: date-only report filters use the Bahrain day, not the UTC day", async () => {
  const merchantId = (
    await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
      `BUG-089 ${randomUUID()}`,
    ])
  ).rows[0]!.id;
  const insert = async (reference: string, occurredAt: string) =>
    pool.query(
      `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, reference, acquirer_reference, occurred_at)
       VALUES ($1, 'captured', 1000, 1000, $2, $3, $4)`,
      [merchantId, reference, `acq_${randomUUID()}`, occurredAt],
    );
  await insert("early-bahrain-2-june", "2026-06-01T22:00:00Z"); // 01:00 on 2 June in Bahrain
  await insert("late-bahrain-2-june", "2026-06-02T20:00:00Z"); // 23:00 on 2 June in Bahrain
  await insert("bahrain-3-june", "2026-06-02T22:00:00Z"); // 01:00 on 3 June in Bahrain

  const rows = await runTransactionsReport(pool, { merchantId, from: "2026-06-02", to: "2026-06-03" });
  assert.deepEqual(rows.map((r) => r.reference).sort(), ["early-bahrain-2-june", "late-bahrain-2-june"]);
});
