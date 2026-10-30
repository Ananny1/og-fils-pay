/**
 * BUG-008 follow-up: migration 0085 re-typed duplicate settlement.paid
 * outbox events to 'settlement.paid.duplicate', but webhook_deliveries rows
 * that were already pending for them were still due, so the dispatcher kept
 * sending the duplicate payout notice. Migration 0086 marks those pending
 * deliveries terminal. Requires a migrated DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { enqueueEvent } from "@filspay/events";
import { loadConfig } from "../config.js";
import { createWebhookEndpoint } from "./create.js";
import { runDispatchPass } from "./dispatcher.js";
import type { WebhookTransport } from "./transport.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("duplicatePayoutDeliveries.test.ts requires DATABASE_URL");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  WEBHOOK_MAX_ATTEMPTS: "3",
  WEBHOOK_BACKOFF_BASE_MS: "1000",
  WEBHOOK_BACKOFF_CAP_MS: "60000",
  WEBHOOK_REQUEST_TIMEOUT_MS: "5000",
});

const MIGRATION_0086 = readFileSync(
  fileURLToPath(new URL("../../../../db/migrations/0086_cancel_duplicate_payout_deliveries.sql", import.meta.url)),
  "utf8",
);

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

test.after(async () => {
  await pool.end();
});

test("a delivery already pending for a 'settlement.paid.duplicate' event is not sent after 0086", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Duplicate Payout Delivery Merchant ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const url = `http://dup-payout.test/webhook-${randomUUID()}`;
  await createWebhookEndpoint(pool, config, {
    merchantId,
    url,
    createdByType: "merchant_session",
    createdById: randomUUID(),
  });
  const batch = await pool.query<{ id: string }>(
    `INSERT INTO settlement_batches
        (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at, paid_at)
     VALUES ($1, current_date, 'paid', 471300, 0, 471300, now(), now())
     RETURNING id`,
    [merchantId],
  );
  const batchId = batch.rows[0]!.id;
  const event = await enqueueEvent(pool, {
    eventType: "settlement.paid",
    aggregateType: "settlement_batch",
    aggregateId: batchId,
    payload: { merchantId, batchId, batchDate: "2026-08-21", netPayoutFils: 471_300 },
  });

  // The pre-0085 state: the delivery row exists and is pending (one failed
  // attempt), then 0085 re-types its event as a duplicate.
  await runDispatchPass(pool, async () => ({ statusCode: 500, body: "" }), config);
  await pool.query(`UPDATE outbox_events SET event_type = 'settlement.paid.duplicate' WHERE id = $1`, [event.id]);
  await pool.query(
    `UPDATE webhook_deliveries SET next_attempt_at = now() - interval '1 second' WHERE outbox_event_id = $1`,
    [event.id],
  );

  await pool.query(MIGRATION_0086);

  let sent = 0;
  const transport: WebhookTransport = async (req) => {
    if (req.url === url) sent += 1;
    return { statusCode: 200, body: "ok" };
  };
  await runDispatchPass(pool, transport, config);

  assert.equal(sent, 0, "duplicate payout notice was sent");
  const row = await pool.query<{ status: string }>(`SELECT status FROM webhook_deliveries WHERE outbox_event_id = $1`, [
    event.id,
  ]);
  assert.equal(row.rows[0]!.status, "failed");
});

test("0086 leaves a pending delivery for a normal event untouched", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Normal Delivery Merchant ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  await createWebhookEndpoint(pool, config, {
    merchantId,
    url: `http://normal.test/webhook-${randomUUID()}`,
    createdByType: "merchant_session",
    createdById: randomUUID(),
  });
  const event = await enqueueEvent(pool, {
    eventType: "transaction.captured",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: { merchantId, amountCapturedFils: 4_750, feeFils: 71, newStatus: "captured", capturedTotalFils: 4_750 },
  });
  await runDispatchPass(pool, async () => ({ statusCode: 500, body: "" }), config);

  await pool.query(MIGRATION_0086);

  const row = await pool.query<{ status: string }>(`SELECT status FROM webhook_deliveries WHERE outbox_event_id = $1`, [
    event.id,
  ]);
  assert.equal(row.rows[0]!.status, "pending");
});
