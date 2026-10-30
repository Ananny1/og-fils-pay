/**
 * BUG-108: the merchant payment-link list's status filter must agree with
 * the status the dashboard shows — an `active` link past its expiry is
 * `expired` (it is never stored that way). Real Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("paymentLinksStatusFilter.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

async function merchantWithLiveAndExpiredLink() {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Filter ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const key = await issueApiKey(pool, config, { merchantId, createdBy: user.rows[0]!.id, label: "k" });
  const headers = { authorization: `Bearer ${key.rawKey}` };
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const res = await app.inject({
      method: "POST",
      url: `/v1/merchants/${merchantId}/payment-links`,
      headers,
      payload: { amountFils: 1_000 + i, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    });
    assert.equal(res.statusCode, 201, res.body);
    ids.push(res.json().id);
  }
  // The second link's expiry passes. It stays stored as 'active': expired is never stored.
  await pool.query(`UPDATE payment_links SET expires_at = now() - interval '1 minute' WHERE id = $1`, [ids[1]]);
  return { merchantId, headers, liveId: ids[0]!, expiredId: ids[1]! };
}

async function listIds(merchantId: string, headers: Record<string, string>, query: string): Promise<string[]> {
  const res = await app.inject({ method: "GET", url: `/v1/merchants/${merchantId}/payment-links${query}`, headers });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().paymentLinks.map((l: { id: string }) => l.id);
}

test("BUG-108: ?status=active leaves out a link whose expiry has passed", async () => {
  const { merchantId, headers, liveId } = await merchantWithLiveAndExpiredLink();
  assert.deepEqual(await listIds(merchantId, headers, "?status=active"), [liveId]);
});

test("BUG-108: ?status=expired returns exactly the past-expiry links", async () => {
  const { merchantId, headers, expiredId } = await merchantWithLiveAndExpiredLink();
  assert.deepEqual(await listIds(merchantId, headers, "?status=expired"), [expiredId]);
});

test("BUG-108: no status filter still lists every link", async () => {
  const { merchantId, headers, liveId, expiredId } = await merchantWithLiveAndExpiredLink();
  assert.deepEqual(new Set(await listIds(merchantId, headers, "")), new Set([liveId, expiredId]));
});
