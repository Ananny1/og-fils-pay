/**
 * SEC-RT-5: the report scope must only widen to a split child of the
 * caller's own marketplace, never to any merchant that happens to be a split
 * child of someone. Real migrated Postgres (DATABASE_URL).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { resolveReportMerchantId } from "./scope.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("scope.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

test.after(async () => {
  await pool.end();
});

async function createMerchant(label: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Scope ${label} ${randomUUID()}`],
  );
  return result.rows[0]!.id;
}

test("a parent can report on its own split child", async () => {
  const parent = await createMerchant("parent");
  const child = await createMerchant("child");
  await pool.query(
    `INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps) VALUES ($1, $2, 10000)`,
    [parent, child],
  );
  assert.equal(await resolveReportMerchantId(pool, parent, child), child);
});

test("another merchant asking for someone else's split child gets its own data, not the child's", async () => {
  const parent = await createMerchant("parent");
  const child = await createMerchant("child");
  const stranger = await createMerchant("stranger");
  await pool.query(
    `INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps) VALUES ($1, $2, 10000)`,
    [parent, child],
  );
  assert.equal(await resolveReportMerchantId(pool, stranger, child), stranger);
});

test("asking for an unrelated merchant falls back to the caller", async () => {
  const caller = await createMerchant("caller");
  const other = await createMerchant("other");
  assert.equal(await resolveReportMerchantId(pool, caller, other), caller);
});
