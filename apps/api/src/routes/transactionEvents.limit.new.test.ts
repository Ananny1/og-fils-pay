/**
 * BUG-103: GET /v1/transactions/:id/events returned every event row with no
 * limit. Requires DATABASE_URL (run `npm run migrate` first).
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
  throw new Error("transactionEvents.limit.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

test("BUG-103: the events timeline is bounded (max 500 rows, oldest first)", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Events Limit ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const owner = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: owner.rows[0]!.id, label: "bug103" });
  const headers = { authorization: `Bearer ${rawKey}` };

  const auth = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: { amountFils: 1000, card: { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" }, reference: "bug103" },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  const txnId = (auth.json() as { id: string }).id;

  // 600 more rows, all later than the real 'authorized' event.
  await pool.query(
    `INSERT INTO transaction_events (transaction_id, event_type, actor_type, metadata, occurred_at)
     SELECT $1, 'authorized', 'system', '{}'::jsonb, now() + make_interval(secs => g)
       FROM generate_series(1, 600) g`,
    [txnId],
  );

  const res = await app.inject({ method: "GET", url: `/v1/transactions/${txnId}/events`, headers });
  assert.equal(res.statusCode, 200, res.body);
  const events = res.json() as { occurredAt: string }[];
  assert.ok(Array.isArray(events), "response shape stays a plain array");
  assert.equal(events.length, 500, `expected a bounded page of 500, got ${events.length}`);
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i - 1]!.occurredAt <= events[i]!.occurredAt, "still oldest first");
  }
});
