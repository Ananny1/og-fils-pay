/**
 * A merchant may run reports for itself and for its OWN split children —
 * never for another parent's child. Real Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { resolveReportMerchantId } from "./scope.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("scope.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

test.after(async () => {
  await pool.end();
});

async function merchant(label: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Scope ${label} ${randomUUID()}`],
  );
  return r.rows[0]!.id;
}

test("BUG-034: a merchant cannot report on another parent's split child", async () => {
  const parent = await merchant("parent");
  const child = await merchant("child");
  const outsider = await merchant("outsider");
  await pool.query(
    `INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps) VALUES ($1, $2, 10000)`,
    [parent, child],
  );

  assert.equal(await resolveReportMerchantId(pool, outsider, child), outsider, "outsider read another merchant's report");
  assert.equal(await resolveReportMerchantId(pool, parent, child), child, "the parent may report on its own child");
  assert.equal(await resolveReportMerchantId(pool, child, parent), child, "a child may not report on its parent");
  assert.equal(await resolveReportMerchantId(pool, outsider, undefined), outsider);
});
