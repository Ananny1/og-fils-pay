/**
 * Ownership regression tests for the merchant payment-link routes, via
 * `app.inject(...)` against a real, migrated Postgres. Requires DATABASE_URL.
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
  throw new Error("paymentLinks.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

async function createMerchantWithApiKey(label: string) {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Link Owner ${label} ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused-in-these-tests') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: user.rows[0]!.id, label });
  return { merchantId, rawKey: issued.rawKey };
}

test("BUG-003: merchant A cannot cancel merchant B's payment link through A's own path", async () => {
  const a = await createMerchantWithApiKey("a");
  const b = await createMerchantWithApiKey("b");

  const created = await app.inject({
    method: "POST",
    url: `/v1/merchants/${b.merchantId}/payment-links`,
    headers: { authorization: `Bearer ${b.rawKey}` },
    payload: { amountFils: 12_500, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.equal(created.statusCode, 201, created.body);
  const bLinkId = (created.json() as { id: string }).id;

  // A uses its own merchant id in the path (passes assertOwnMerchant) with B's link id.
  const cancel = await app.inject({
    method: "DELETE",
    url: `/v1/merchants/${a.merchantId}/payment-links/${bLinkId}`,
    headers: { authorization: `Bearer ${a.rawKey}` },
  });
  assert.equal(cancel.statusCode, 404, `cross-merchant cancel: ${cancel.statusCode} ${cancel.body}`);
  assert.equal(cancel.json().error, "payment_link_not_found");

  const row = await pool.query<{ status: string }>(`SELECT status FROM payment_links WHERE id = $1`, [bLinkId]);
  assert.equal(row.rows[0]!.status, "active", "merchant B's link must be untouched");

  // B can still cancel its own link.
  const own = await app.inject({
    method: "DELETE",
    url: `/v1/merchants/${b.merchantId}/payment-links/${bLinkId}`,
    headers: { authorization: `Bearer ${b.rawKey}` },
  });
  assert.equal(own.statusCode, 204, own.body);
});
