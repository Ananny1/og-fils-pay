/**
 * BUG-009: expire_holds against a real database. Each test runs inside a
 * transaction that is rolled back, so the seeded data is left untouched.
 * Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { expireHolds } from "./expire_holds.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("expire_holds.integration.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

test.after(async () => {
  await pool.end();
});

async function inRolledBackTx(fn: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Start from a known state: no existing hold is past expiry.
    await client.query(`UPDATE holds SET expires_at = now() + interval '1 day' WHERE status = 'active'`);
    await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function insertHold(client: PoolClient, status: string, expiresAt: string): Promise<string> {
  const merchant = await client.query<{ id: string }>(`SELECT id FROM merchants ORDER BY id LIMIT 1`);
  const result = await client.query<{ id: string }>(
    `INSERT INTO holds (merchant_id, amount_fils, status, expires_at)
     VALUES ($1, 1000, $2, now() + $3::interval) RETURNING id`,
    [merchant.rows[0]!.id, status, expiresAt],
  );
  return result.rows[0]!.id;
}

async function countHolds(client: PoolClient): Promise<number> {
  const result = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM holds`);
  return result.rows[0]!.n;
}

test("a night with nothing expired changes no rows and deletes nothing", async () => {
  await inRolledBackTx(async (client) => {
    await insertHold(client, "active", "1 hour");
    const before = await countHolds(client);

    const expired = await expireHolds(client);

    assert.equal(expired, 0);
    assert.equal(await countHolds(client), before);
  });
});

test("only active holds past expires_at flip to 'expired'; nothing is deleted", async () => {
  await inRolledBackTx(async (client) => {
    const pastActive = await insertHold(client, "active", "-1 hour");
    const futureActive = await insertHold(client, "active", "1 hour");
    const pastReleased = await insertHold(client, "released", "-1 hour");
    const before = await countHolds(client);

    const expired = await expireHolds(client);

    assert.equal(expired, 1);
    assert.equal(await countHolds(client), before);
    const statuses = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM holds WHERE id = ANY($1::uuid[])`,
      [[pastActive, futureActive, pastReleased]],
    );
    const byId = new Map(statuses.rows.map((r) => [r.id, r.status]));
    assert.equal(byId.get(pastActive), "expired");
    assert.equal(byId.get(futureActive), "active");
    assert.equal(byId.get(pastReleased), "released");
  });
});
