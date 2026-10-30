/**
 * Merchant payment-link list input-handling regression tests: bad query
 * strings must not turn into a 500. Real Postgres via DATABASE_URL.
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
  throw new Error("paymentLinksList.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

async function merchantWithLinks(count: number) {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`List ${randomUUID()}`],
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
  for (let i = 0; i < count; i++) {
    const res = await app.inject({
      method: "POST",
      url: `/v1/merchants/${merchantId}/payment-links`,
      headers,
      payload: { amountFils: 1_000 + i, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    });
    assert.equal(res.statusCode, 201, res.body);
  }
  return { merchantId, headers };
}

test("BUG-101: a non-numeric ?limit= falls back to the default page instead of a 500", async () => {
  const { merchantId, headers } = await merchantWithLinks(2);
  const res = await app.inject({ method: "GET", url: `/v1/merchants/${merchantId}/payment-links?limit=abc`, headers });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().paymentLinks.length, 2);
});
