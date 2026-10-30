/**
 * API-key revocation regression tests: an admin rotation must cut the old
 * key off, and a scheduled `revoke_after` (0056) must be honoured. Real
 * Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { loadConfig } from "../config.js";
import { issueApiKey } from "./issue.js";
import { verifyApiKey } from "./verify.js";
import { rotateApiKeyAsAdmin } from "../admin/apiKeys.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("verify.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 3 });

test.after(async () => {
  await pool.end();
});

async function merchantWithKey(label: string) {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Key ${label} ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  const key = await issueApiKey(pool, config, { merchantId, createdBy: user.rows[0]!.id, label });
  return { merchantId, key };
}

async function adminUser(): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role)
     VALUES ($1, 'unused', 'Rotator', 'finance') RETURNING id`,
    [`rotator-${randomUUID()}@admin.test`],
  );
  return r.rows[0]!.id;
}

test("BUG-012: after an admin rotation the old key no longer authenticates; the new one does", async () => {
  const { merchantId, key } = await merchantWithKey("rotate");
  assert.ok(await verifyApiKey(pool, key.rawKey), "old key works before rotation");

  const rotated = await rotateApiKeyAsAdmin(pool, config, {
    merchantId,
    apiKeyId: key.id,
    adminUserId: await adminUser(),
  });

  assert.equal(await verifyApiKey(pool, key.rawKey), null, "the rotated-out key must stop working");
  const fresh = await verifyApiKey(pool, rotated.rawKey);
  assert.equal(fresh?.apiKeyId, rotated.id);

  const old = await pool.query<{ revoked_at: Date | null; revoked_reason: string | null }>(
    `SELECT revoked_at, revoked_reason FROM api_keys WHERE id = $1`,
    [key.id],
  );
  assert.ok(old.rows[0]!.revoked_at, "old key row must be revoked");
  assert.equal(old.rows[0]!.revoked_reason, "rotated");
});

test("BUG-012: a key past its scheduled revoke_after no longer authenticates", async () => {
  const { key } = await merchantWithKey("revoke-after");
  await pool.query(`UPDATE api_keys SET revoke_after = now() - interval '1 second' WHERE id = $1`, [key.id]);
  assert.equal(await verifyApiKey(pool, key.rawKey), null);

  const { key: future } = await merchantWithKey("revoke-after-future");
  await pool.query(`UPDATE api_keys SET revoke_after = now() + interval '1 hour' WHERE id = $1`, [future.id]);
  assert.ok(await verifyApiKey(pool, future.rawKey), "a future revoke_after still authenticates until then");
});
