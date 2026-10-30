/**
 * BUG-104: a replay must reuse the original event's delivery id. The id in
 * the envelope (and the Webhook-Delivery-Id header, which the dispatcher reads
 * from `delivery_event_id`) is the only key a receiver can dedupe on. Before
 * the fix every replay minted a new one, so replaying `settlement.paid` made a
 * merchant's system book the payout a second time.
 * Requires DATABASE_URL (migrated Postgres).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createWebhookDeliveryArchive, replayWebhookDeliveryArchive } from "./archiveReplay.js";
import { createWebhookEndpoint } from "./create.js";
import { replayWebhookDelivery } from "./replay.js";
import { replayWebhookDeliveriesBatch } from "./replayBatch.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("replay.new.test.ts requires DATABASE_URL");

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
test.after(async () => {
  await pool.end();
});

const config = {
  nodeEnv: "test" as const,
  webhookSecretEncryptionKey: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
};

async function setup(status: string) {
  const adminUserId = (
    await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, display_name, role)
       VALUES ($1, 'not-a-real-hash', 'BUG-104', 'support') RETURNING id`,
      [`bug-104-${randomUUID()}@admin.test`],
    )
  ).rows[0]!.id;
  const merchantId = (
    await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
      `BUG-104 ${randomUUID()}`,
    ])
  ).rows[0]!.id;
  const endpoint = await createWebhookEndpoint(pool, config, {
    merchantId,
    url: "http://fake-receiver.test/bug-104",
    createdByType: "merchant_session",
    createdById: randomUUID(),
  });
  const outboxEventId = (
    await pool.query<{ id: string }>(
      `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
       VALUES ('settlement.paid', 'settlement_batch', $1, $2) RETURNING id`,
      [randomUUID(), JSON.stringify({ merchantId, netPayoutFils: 4_750 })],
    )
  ).rows[0]!.id;
  const eventId = randomUUID();
  const envelope = { id: eventId, type: "settlement.paid", data: { merchantId, netPayoutFils: 4_750 } };
  const originalId = (
    await pool.query<{ id: string }>(
      `INSERT INTO webhook_deliveries (endpoint_id, outbox_event_id, event_type, delivery_event_id, payload, status)
       VALUES ($1, $2, 'settlement.paid', $3, $4, $5) RETURNING id`,
      [endpoint.id, outboxEventId, eventId, JSON.stringify(envelope), status],
    )
  ).rows[0]!.id;
  return { adminUserId, merchantId, endpointId: endpoint.id, eventId, originalId };
}

async function replayRow(id: string) {
  const r = await pool.query<{ delivery_event_id: string; payload: { id: string; type: string } }>(
    `SELECT delivery_event_id, payload FROM webhook_deliveries WHERE id = $1`,
    [id],
  );
  return r.rows[0]!;
}

test("BUG-104: single replay keeps the original event id (column and envelope)", async () => {
  const s = await setup("succeeded");
  const result = await replayWebhookDelivery(pool, {
    merchantId: s.merchantId,
    endpointId: s.endpointId,
    deliveryId: s.originalId,
  });
  assert.notEqual(result.deliveryId, s.originalId, "a replay is still its own row");
  const row = await replayRow(result.deliveryId);
  assert.equal(row.delivery_event_id, s.eventId, "Webhook-Delivery-Id must be the original id");
  assert.equal(row.payload.id, s.eventId, "envelope id must be the original id");
  assert.equal(row.payload.type, "settlement.paid");
});

test("BUG-104: admin batch replay keeps the original event id", async () => {
  const s = await setup("exhausted");
  const result = await replayWebhookDeliveriesBatch(pool, {
    merchantId: s.merchantId,
    endpointId: s.endpointId,
    adminUserId: s.adminUserId,
    statuses: ["exhausted"],
    from: new Date(Date.now() - 3_600_000),
    to: new Date(Date.now() + 3_600_000),
  });
  assert.equal(result.replayedDeliveryIds.length, 1);
  const row = await replayRow(result.replayedDeliveryIds[0]!);
  assert.equal(row.delivery_event_id, s.eventId);
  assert.equal(row.payload.id, s.eventId);
});

test("BUG-104: archive restore keeps the original event id", async () => {
  const s = await setup("succeeded");
  const { archiveId } = await createWebhookDeliveryArchive(pool, {
    merchantId: s.merchantId,
    endpointId: s.endpointId,
    adminUserId: s.adminUserId,
    from: new Date(Date.now() - 3_600_000),
    to: new Date(Date.now() + 3_600_000),
  });
  // Restore onto a fresh endpoint of the same merchant (the original
  // endpoint already has the event delivered, so BUG-081 would skip it).
  const target = await createWebhookEndpoint(pool, config, {
    merchantId: s.merchantId,
    url: "http://fake-receiver.test/bug-104-target",
    createdByType: "merchant_session",
    createdById: randomUUID(),
  });
  const result = await replayWebhookDeliveryArchive(pool, {
    merchantId: s.merchantId,
    archiveId,
    targetEndpointId: target.id,
    adminUserId: s.adminUserId,
  });
  assert.equal(result.replayedCount, 1);
  const r = await pool.query<{ delivery_event_id: string; payload: { id: string } }>(
    `SELECT delivery_event_id, payload FROM webhook_deliveries WHERE endpoint_id = $1`,
    [target.id],
  );
  assert.equal(r.rows[0]!.delivery_event_id, s.eventId);
  assert.equal(r.rows[0]!.payload.id, s.eventId);
});
