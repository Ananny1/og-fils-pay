/**
 * BUG-054: the reconciliation's pending (unbatched) estimate must use the
 * fee rate the capture actually charged — the effective-dated fee schedule
 * — not merchants.mdr_bps. Otherwise any merchant with a negotiated rate
 * shows an "unexplained" gap. Requires DATABASE_URL (real, migrated DB).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { getReconciliationReport } from "./query.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("reconciliation.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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

function todayBahrain(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test("BUG-054: a capture under a negotiated fee schedule (225 bps, merchant default 250) reconciles with zero gap", async () => {
  const merchantResult = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Reconciliation Schedule ${randomUUID()}`],
  );
  const merchantId = merchantResult.rows[0]!.id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: user.rows[0]!.id, label: "recon" });
  await pool.query(
    `INSERT INTO fee_schedules (merchant_id, mdr_bps, effective_from) VALUES ($1, 225, now() - interval '30 days')`,
    [merchantId],
  );

  const headers = { authorization: `Bearer ${rawKey}` };
  const auth = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: { amountFils: 100_000, card: VALID_CARD, reference: "recon-1" },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  const cap = await app.inject({
    method: "POST",
    url: `/v1/transactions/${auth.json().id}/capture`,
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: {},
  });
  assert.equal(cap.statusCode, 200, cap.body);

  const from = todayBahrain();
  const report = await getReconciliationReport(pool, { merchantId, from, to: nextDay(from) });

  assert.equal(report.settlementNetPayoutFils, 0);
  assert.equal(report.pendingUnbatchedFils, report.ledgerMerchantPayableNetFils);
  assert.equal(report.gapFils, 0);
  assert.equal(report.explained, true);
});
