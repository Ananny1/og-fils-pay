/**
 * BUG-074: a bad amountFils on authorize or capture is a 400, never a 500.
 * `app.inject(...)` against `buildApp()` and a real, migrated Postgres.
 * Requires DATABASE_URL.
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
  throw new Error("transactions.amount.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
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

const VALID_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

async function createApprovedMerchantWithApiKey(label: string) {
  const merchantResult = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Test Merchant ${label} ${randomUUID()}`],
  );
  const merchantId = merchantResult.rows[0]!.id;
  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused-in-these-tests')
     RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: userResult.rows[0]!.id, label });
  return { merchantId, rawKey: issued.rawKey };
}

function authHeader(rawKey: string) {
  return { authorization: `Bearer ${rawKey}` };
}

const BAD_AMOUNTS: unknown[] = [0, -100, 1.5, "1000", null, true, 1e300];

test("BUG-074: authorize with a bad amountFils is 400 invalid_amount, never 500", async () => {
  const { rawKey } = await createApprovedMerchantWithApiKey("bad-authorize-amount");
  for (const amountFils of BAD_AMOUNTS) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/transactions",
      headers: { ...authHeader(rawKey), "idempotency-key": randomUUID() },
      payload: { amountFils, card: VALID_CARD },
    });
    assert.equal(res.statusCode, 400, `amountFils=${JSON.stringify(amountFils)}: ${res.body}`);
    assert.equal(res.json().error, "invalid_amount");
  }
});

test("BUG-074: capture with a bad amountFils is 400 invalid_amount, never 500", async () => {
  const { rawKey } = await createApprovedMerchantWithApiKey("bad-capture-amount");
  const auth = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { ...authHeader(rawKey), "idempotency-key": randomUUID() },
    payload: { amountFils: 10_000, card: VALID_CARD },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  const txnId = (auth.json() as { id: string }).id;

  const capture = (payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: `/v1/transactions/${txnId}/capture`,
      headers: { ...authHeader(rawKey), "idempotency-key": randomUUID() },
      payload,
    });

  // 0 is excluded: capture answers it with its own 422 capture_exceeds_remaining.
  for (const amountFils of BAD_AMOUNTS.filter((a) => a !== 0)) {
    const res = await capture({ amountFils });
    assert.equal(res.statusCode, 400, `amountFils=${JSON.stringify(amountFils)}: ${res.body}`);
    assert.equal(res.json().error, "invalid_amount");
  }
  // Omitted still means "the full remaining amount".
  const ok = await capture({});
  assert.equal(ok.statusCode, 200, ok.body);
});
