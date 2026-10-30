/**
 * BUG-070: an API key of a suspended or closed merchant must stop working,
 * like that merchant's dashboard sessions do (SEC-RT-2). Real Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { loadConfig } from "../config.js";
import { issueApiKey } from "./issue.js";
import { verifyApiKey } from "./verify.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("verify.suspended.new.test.ts requires DATABASE_URL");

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
test.after(async () => {
  await pool.end();
});

async function merchantWithKey() {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Suspended key ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  const key = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label: "s" });
  return { merchantId, rawKey: key.rawKey };
}

for (const status of ["suspended", "closed"] as const) {
  test(`a ${status} merchant's API key no longer authenticates`, async () => {
    const { merchantId, rawKey } = await merchantWithKey();
    assert.ok(await verifyApiKey(pool, rawKey), "active merchant: key works");
    await pool.query(`UPDATE merchants SET status = $2 WHERE id = $1`, [merchantId, status]);
    assert.equal(await verifyApiKey(pool, rawKey), null);
  });
}
