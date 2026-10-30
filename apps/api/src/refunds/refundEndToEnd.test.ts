/**
 * FP-300.6 — one refund, followed through every system it touches, against a
 * real migrated Postgres (requires DATABASE_URL):
 * authorize + capture → partial refund over HTTP → ledger to the fil →
 * signed refund.succeeded webhook → what the next settlement batch deducts →
 * timeline → reporting rollup → reconciliation gap 0.
 *
 * The batch close itself is Go (apps/settlement CloseBatch step 9). Here we
 * assert the exact rows it reads and the net it must produce; the Go side is
 * proven by TestCloseBatch_DeductsRefundsFromNet and
 * TestCloseBatch_RefundLargerThanNetCarriesForward
 * (apps/settlement/internal/settlement/refund_batch_test.go).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { applyRateFils, toFils } from "@filspay/money";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { createWebhookEndpoint } from "../webhooks/create.js";
import { runDispatchPass } from "../webhooks/dispatcher.js";
import { verifySignature } from "../webhooks/sign.js";
import { WEBHOOK_SIGNATURE_HEADER } from "../webhooks/headers.js";
import type { WebhookTransport, WebhookTransportRequest } from "../webhooks/transport.js";
import { withTransaction } from "../db/withTransaction.js";
import { applyEvent, type OutboxEventRow } from "../../../reporting/src/consumer/applyEvent.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("refundEndToEnd.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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
const MDR_BPS = 250;

/** Asia/Bahrain is a fixed UTC+3 (no DST). */
function bahrainDate(offsetDays = 0): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test("FP-300.6: a partial refund flows through ledger, webhook, next batch, timeline, reports and reconciliation", async () => {
  // --- a merchant with an API key and a webhook endpoint
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, $2) RETURNING id`,
    [`Refund E2E ${randomUUID()}`, MDR_BPS],
  );
  const merchantId = merchant.rows[0]!.id;
  const owner = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: owner.rows[0]!.id, label: "e2e" });
  const auth = { authorization: `Bearer ${rawKey}` };
  const endpointUrl = `http://fake-receiver.test/refund-e2e-${randomUUID()}`;
  const endpoint = await createWebhookEndpoint(pool, config, {
    merchantId,
    url: endpointUrl,
    createdByType: "merchant_session",
    createdById: randomUUID(),
  });

  // --- 10.000 BD authorized and captured
  const authorized = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { ...auth, "idempotency-key": randomUUID() },
    payload: { amountFils: 10_000, card: VALID_CARD, reference: "refund-e2e" },
  });
  assert.equal(authorized.statusCode, 201, authorized.body);
  const txnId = (authorized.json() as { id: string }).id;
  const captured = await app.inject({
    method: "POST",
    url: `/v1/transactions/${txnId}/capture`,
    headers: { ...auth, "idempotency-key": randomUUID() },
    payload: {},
  });
  assert.equal(captured.statusCode, 200, captured.body);
  const feeFils = Number(applyRateFils(toFils(10_000), MDR_BPS));

  // --- 4.000 BD refunded through the HTTP route
  const refunded = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/refunds`,
    headers: { ...auth, "idempotency-key": randomUUID() },
    payload: { transactionId: txnId, amountFils: 4_000, reason: "e2e" },
  });
  assert.equal(refunded.statusCode, 200, refunded.body);
  const refund = refunded.json() as { id: string; amountFils: number; feeReversedFils: number; transactionStatus: string };
  assert.equal(refund.amountFils, 4_000);
  assert.equal(refund.transactionStatus, "partially_refunded");
  // Fee given back in proportion: 4000 / 10000 of the fee, never more.
  assert.equal(refund.feeReversedFils, Number(applyRateFils(toFils(4_000), MDR_BPS)));
  const refundCostFils = refund.amountFils - refund.feeReversedFils;

  // --- 1. ledger: every entry group balances, merchant_payable is right to the fil
  const groups = await pool.query<{ debit: string; credit: string }>(
    `SELECT SUM(amount_fils) FILTER (WHERE direction = 'debit')::text  AS debit,
            SUM(amount_fils) FILTER (WHERE direction = 'credit')::text AS credit
       FROM ledger_entries WHERE transaction_id = $1 GROUP BY entry_group_id`,
    [txnId],
  );
  assert.ok(groups.rows.length >= 2, "a capture group and a refund group");
  for (const g of groups.rows) assert.equal(g.debit, g.credit, "every ledger entry group balances");
  const payable = await pool.query<{ net: string }>(
    `SELECT SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END)::text AS net
       FROM ledger_entries WHERE transaction_id = $1 AND account_id = 'merchant_payable'`,
    [txnId],
  );
  assert.equal(Number(payable.rows[0]!.net), 10_000 - feeFils - refundCostFils);

  // --- 2. webhook: refund.succeeded delivered once, signed
  const sent: WebhookTransportRequest[] = [];
  const transport: WebhookTransport = async (req) => {
    if (req.url === endpointUrl) sent.push(req);
    return { statusCode: 200, body: "ok" };
  };
  await runDispatchPass(pool, transport, config);
  const refundHooks = sent.filter((r) => (JSON.parse(r.body) as { type: string }).type === "refund.succeeded");
  assert.equal(refundHooks.length, 1);
  const hookBody = JSON.parse(refundHooks[0]!.body) as { type: string; data: Record<string, unknown> };
  assert.equal(hookBody.data.refundId, refund.id);
  assert.equal(hookBody.data.amountFils, 4_000);
  assert.deepEqual(verifySignature(hookBody, refundHooks[0]!.headers[WEBHOOK_SIGNATURE_HEADER]!, endpoint.secret), {
    valid: true,
  });
  const delivery = await pool.query<{ status: string }>(
    `SELECT d.status FROM webhook_deliveries d JOIN outbox_events e ON e.id = d.outbox_event_id
      WHERE d.endpoint_id = $1 AND e.event_type = 'refund.succeeded'`,
    [endpoint.id],
  );
  assert.deepEqual(delivery.rows.map((r) => r.status), ["succeeded"]);

  // --- 3. next batch: exactly what Go CloseBatch step 9 reads and deducts
  const unbatched = await pool.query<{ id: string; amount_fils: string; fee_reversed_fils: string }>(
    `SELECT id, amount_fils, fee_reversed_fils FROM refunds
      WHERE merchant_id = $1 AND status = 'succeeded' AND settlement_batch_id IS NULL`,
    [merchantId],
  );
  assert.equal(unbatched.rows.length, 1);
  assert.equal(unbatched.rows[0]!.id, refund.id);
  const expectedBatchNet = 10_000 - feeFils - (Number(unbatched.rows[0]!.amount_fils) - Number(unbatched.rows[0]!.fee_reversed_fils));
  assert.equal(expectedBatchNet, Number(payable.rows[0]!.net), "the batch pays exactly what the ledger owes");

  // --- 4. timeline
  const events = await app.inject({ method: "GET", url: `/v1/transactions/${txnId}/events`, headers: auth });
  assert.equal(events.statusCode, 200, events.body);
  const refundEvent = (events.json() as { eventType: string; amountFils: number; metadata: Record<string, unknown> }[]).find(
    (e) => e.eventType === "refund_partial",
  );
  assert.ok(refundEvent, "the refund is in the timeline");
  assert.equal(refundEvent.amountFils, -4_000);
  assert.equal(refundEvent.metadata.transactionStatus, "partially_refunded");

  // --- 5. reporting: the consumer's own applier counts the refund on the Bahrain day
  const outbox = await pool.query<OutboxEventRow>(
    `SELECT id, event_type, aggregate_id, payload, created_at FROM outbox_events
      WHERE event_type = 'refund.succeeded' AND aggregate_id = $1`,
    [txnId],
  );
  assert.equal(outbox.rows.length, 1);
  await withTransaction(pool, (client) => applyEvent(client, outbox.rows[0]!));
  const rollup = await pool.query<{ refund_count: number; refund_gross_fils: string }>(
    `SELECT refund_count, refund_gross_fils::text FROM merchant_daily_volume WHERE merchant_id = $1 AND volume_date = $2`,
    [merchantId, bahrainDate()],
  );
  assert.equal(rollup.rows[0]?.refund_count, 1);
  assert.equal(Number(rollup.rows[0]?.refund_gross_fils), 4_000);

  // --- 6. reconciliation: captured - fees - refunds = paid + pending, gap 0
  const recon = await app.inject({
    method: "GET",
    url: `/v1/settlement/reconciliation?from=${bahrainDate()}&to=${bahrainDate(1)}`,
    headers: auth,
  });
  assert.equal(recon.statusCode, 200, recon.body);
  const report = recon.json() as { ledgerMerchantPayableNetFils: number; pendingUnbatchedFils: number; gapFils: number; explained: boolean };
  assert.equal(report.ledgerMerchantPayableNetFils, expectedBatchNet);
  assert.equal(report.pendingUnbatchedFils, expectedBatchNet);
  assert.equal(report.gapFils, 0);
  assert.equal(report.explained, true);
});
