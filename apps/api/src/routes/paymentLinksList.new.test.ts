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

test("BUG-102: a malformed cursor restarts from the first page instead of a 500", async () => {
  const { merchantId, headers } = await merchantWithLinks(2);
  for (const raw of ["garbage|x", "2026-10-30 10:00:00+00|not-a-uuid", "not-a-date|00000000-0000-0000-0000-000000000000"]) {
    const cursor = Buffer.from(raw, "utf8").toString("base64url");
    const res = await app.inject({ method: "GET", url: `/v1/merchants/${merchantId}/payment-links?cursor=${cursor}`, headers });
    assert.equal(res.statusCode, 200, `${raw}: ${res.body}`);
    assert.equal(res.json().paymentLinks.length, 2, raw);
  }
});

test("BUG-102: a real nextCursor still pages through every link exactly once", async () => {
  const { merchantId, headers } = await merchantWithLinks(3);
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const url: string = `/v1/merchants/${merchantId}/payment-links?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
    const res = await app.inject({ method: "GET", url, headers });
    assert.equal(res.statusCode, 200, res.body);
    for (const link of res.json().paymentLinks) seen.push(link.id);
    cursor = res.json().nextCursor;
  } while (cursor);
  assert.equal(seen.length, 3);
  assert.equal(new Set(seen).size, 3);
});

test("BUG-103: cancelling a link id that is not a UUID is a 404, not a 500", async () => {
  const { merchantId, headers } = await merchantWithLinks(0);
  const res = await app.inject({ method: "DELETE", url: `/v1/merchants/${merchantId}/payment-links/not-a-uuid`, headers });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error, "payment_link_not_found");
});
