/**
 * BUG-111: the 0007 ledger trigger only re-checks the NEW row's group, so an
 * UPDATE can move a leg out of a group and leave that group unbalanced, and a
 * whole balanced group can be edited or deleted. Each test runs in a
 * rolled-back transaction; SET CONSTRAINTS ALL IMMEDIATE fires the deferred
 * balance trigger as a COMMIT would. Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool, type PoolClient } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("ledger_append_only.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

test.after(async () => {
  await pool.end();
});

const GROUP_A = "aaaaaaaa-0000-4000-8000-000000000111";
const GROUP_B = "bbbbbbbb-0000-4000-8000-000000000111";

async function withTwoBalancedGroups(fn: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const m = await client.query<{ id: string }>(
      `INSERT INTO merchants (display_name) VALUES ('BUG-111 shop') RETURNING id`,
    );
    const merchantId = m.rows[0]!.id;
    for (const group of [GROUP_A, GROUP_B]) {
      await client.query(
        `INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at)
         VALUES ($1, $2, 'card_scheme_clearing', 'debit', 100, now()),
                ($1, $2, 'merchant_payable', 'credit', 100, now())`,
        [group, merchantId],
      );
    }
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/** Runs the statements and the deferred commit-time check; true if the database refused. */
async function refused(client: PoolClient, statements: string[]): Promise<boolean> {
  await client.query("SAVEPOINT attempt");
  try {
    for (const s of statements) await client.query(s);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("RELEASE SAVEPOINT attempt");
    return false;
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT attempt");
    return true;
  }
}

test("moving a leg to another group cannot leave the old group unbalanced", async () => {
  await withTwoBalancedGroups(async (client) => {
    const wasRefused = await refused(client, [
      `UPDATE ledger_entries SET entry_group_id = '${GROUP_B}' WHERE entry_group_id = '${GROUP_A}' AND direction = 'debit'`,
      `UPDATE ledger_entries SET amount_fils = 200 WHERE entry_group_id = '${GROUP_B}' AND direction = 'credit'`,
    ]);
    const net = await client.query<{ net: string }>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_fils ELSE -amount_fils END), 0) AS net
         FROM ledger_entries WHERE entry_group_id = $1`,
      [GROUP_A],
    );
    assert.equal(Number(net.rows[0]!.net), 0, "group A must still balance");
    assert.equal(wasRefused, true);
  });
});

test("a posted, balanced group cannot be edited", async () => {
  await withTwoBalancedGroups(async (client) => {
    assert.equal(
      await refused(client, [`UPDATE ledger_entries SET amount_fils = 1 WHERE entry_group_id = '${GROUP_A}'`]),
      true,
    );
  });
});

test("a posted, balanced group cannot be deleted", async () => {
  await withTwoBalancedGroups(async (client) => {
    assert.equal(await refused(client, [`DELETE FROM ledger_entries WHERE entry_group_id = '${GROUP_A}'`]), true);
  });
});

test("new balanced groups still post, unbalanced ones are still refused", async () => {
  await withTwoBalancedGroups(async (client) => {
    const merchant = await client.query<{ merchant_id: string }>(
      `SELECT merchant_id FROM ledger_entries WHERE entry_group_id = $1 LIMIT 1`,
      [GROUP_A],
    );
    const id = merchant.rows[0]!.merchant_id;
    assert.equal(
      await refused(client, [
        `INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at)
         VALUES (gen_random_uuid(), '${id}', 'card_scheme_clearing', 'debit', 5, now())`,
      ]),
      true,
    );
    assert.equal(
      await refused(client, [
        `INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at)
         VALUES ('cccccccc-0000-4000-8000-000000000111', '${id}', 'card_scheme_clearing', 'debit', 5, now()),
                ('cccccccc-0000-4000-8000-000000000111', '${id}', 'merchant_payable', 'credit', 5, now())`,
      ]),
      false,
    );
  });
});
