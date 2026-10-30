/**
 * BUG-087: admin batch replay must queue each event at most once per
 * endpoint. Every replay row gets a NEW delivery id (replay.ts), so the
 * receiver cannot dedupe a second copy: before the fix, clicking "replay
 * batch" twice, or replaying a range that holds both an exhausted original
 * and its exhausted replay, queued the same event two or more times.
 * Requires DATABASE_URL (migrated Postgres).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createWebhookEndpoint } from "./create.js";
import { replayWebhookDeliveriesBatch } from "./replayBatch.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("replayBatch.new.test.ts requires DATABASE_URL");

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
test.after(async () => {
  await pool.end();
});

const config = {
  nodeEnv: "test" as const,
  webhookSecretEncryptionKey: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
};

async function setup() {
  const adminUserId = (
    await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, display_name, role)
       VALUES ($1, 'not-a-real-hash', 'BUG-087', 'support') RETURNING id`,
      [`bug-087-${randomUUID()}@admin.test`],
    )
  ).rows[0]!.id;
  const merchantId = (
    await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
      `BUG-087 ${randomUUID()}`,
    ])
  ).rows[0]!.id;
  const endpoint = await createWebhookEndpoint(pool, config, {
    merchantId,
    url: "http://fake-receiver.test/bug-087",
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
  const original = (
    await pool.query<{ id: string }>(
      `INSERT INTO webhook_deliveries (endpoint_id, outbox_event_id, event_type, delivery_event_id, payload, status)
       VALUES ($1, $2, 'settlement.paid', $3, '{}'::jsonb, 'exhausted') RETURNING id`,
      [endpoint.id, outboxEventId, randomUUID()],
    )
  ).rows[0]!.id;
  return { adminUserId, merchantId, endpointId: endpoint.id, outboxEventId, original };
}

const window = () => ({ from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000) });

async function queuedCopies(outboxEventId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM webhook_deliveries WHERE outbox_event_id = $1 AND status = 'pending'`,
    [outboxEventId],
  );
  return Number(r.rows[0]!.n);
}

test("BUG-087: replaying the same batch twice queues the event once", async () => {
  const s = await setup();
  const input = { merchantId: s.merchantId, endpointId: s.endpointId, adminUserId: s.adminUserId, statuses: ["exhausted"] };

  const first = await replayWebhookDeliveriesBatch(pool, { ...input, ...window() });
  assert.equal(first.matchedCount, 1);
  const second = await replayWebhookDeliveriesBatch(pool, { ...input, ...window() });
  assert.equal(second.matchedCount, 0, "the event is already queued for this endpoint");
  assert.equal(await queuedCopies(s.outboxEventId), 1);
});

test("BUG-087: an exhausted original plus its exhausted replay are replayed as one event", async () => {
  const s = await setup();
  await pool.query(
    `INSERT INTO webhook_deliveries
        (endpoint_id, outbox_event_id, event_type, delivery_event_id, payload, status, replay_of_delivery_id)
     VALUES ($1, $2, 'settlement.paid', $3, '{}'::jsonb, 'exhausted', $4)`,
    [s.endpointId, s.outboxEventId, randomUUID(), s.original],
  );

  const result = await replayWebhookDeliveriesBatch(pool, {
    merchantId: s.merchantId,
    endpointId: s.endpointId,
    adminUserId: s.adminUserId,
    statuses: ["exhausted"],
    ...window(),
  });
  assert.equal(result.matchedCount, 1);
  assert.equal(await queuedCopies(s.outboxEventId), 1);
});

test("BUG-087: an exhausted original whose replay already succeeded is not re-sent", async () => {
  const s = await setup();
  await pool.query(
    `INSERT INTO webhook_deliveries
        (endpoint_id, outbox_event_id, event_type, delivery_event_id, payload, status, replay_of_delivery_id)
     VALUES ($1, $2, 'settlement.paid', $3, '{}'::jsonb, 'succeeded', $4)`,
    [s.endpointId, s.outboxEventId, randomUUID(), s.original],
  );

  const result = await replayWebhookDeliveriesBatch(pool, {
    merchantId: s.merchantId,
    endpointId: s.endpointId,
    adminUserId: s.adminUserId,
    statuses: ["exhausted"],
    ...window(),
  });
  assert.equal(result.matchedCount, 0, "the merchant already received this event");
  assert.equal(await queuedCopies(s.outboxEventId), 0);
});
