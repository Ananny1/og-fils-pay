/**
 * BUG-085: deleting a webhook endpoint that already has deliveries must
 * succeed (204), keep the delivery log, and stop any pending retries.
 * Before the fix the DELETE hit the webhook_deliveries FK (no ON DELETE
 * action) and the route answered 500.
 * Requires DATABASE_URL (migrated Postgres).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createWebhookEndpoint } from "./create.js";
import { deleteWebhookEndpoint } from "./cancel.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("cancel.new.test.ts requires DATABASE_URL");

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
test.after(async () => {
  await pool.end();
});

const config = {
  nodeEnv: "test" as const,
  webhookSecretEncryptionKey: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
};

test("BUG-085: deleting an endpoint with deliveries keeps the log and stops pending retries", async () => {
  const merchantId = (
    await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
      `BUG-085 ${randomUUID()}`,
    ])
  ).rows[0]!.id;
  const endpoint = await createWebhookEndpoint(pool, config, {
    merchantId,
    url: "http://127.0.0.1:9/hook",
    createdByType: "merchant_api_key",
    createdById: randomUUID(),
  });
  const outboxId = (
    await pool.query<{ id: string }>(
      `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
       VALUES ('transaction.voided', 'transaction', $1, $2) RETURNING id`,
      [randomUUID(), JSON.stringify({ merchantId })],
    )
  ).rows[0]!.id;
  const delivery = await pool.query<{ id: string }>(
    `INSERT INTO webhook_deliveries (endpoint_id, outbox_event_id, event_type, delivery_event_id, payload, status)
     VALUES ($1, $2, 'transaction.voided', $3, '{}'::jsonb, 'pending') RETURNING id`,
    [endpoint.id, outboxId, randomUUID()],
  );
  const deliveryId = delivery.rows[0]!.id;

  const result = await deleteWebhookEndpoint(pool, { merchantId, id: endpoint.id });
  assert.equal(result, "deleted");

  const after = await pool.query<{ endpoint_id: string | null; status: string }>(
    `SELECT endpoint_id, status FROM webhook_deliveries WHERE id = $1`,
    [deliveryId],
  );
  assert.equal(after.rows.length, 1, "the delivery log row is kept");
  assert.equal(after.rows[0]!.endpoint_id, null);
  assert.notEqual(after.rows[0]!.status, "pending", "no retry is left queued for a deleted endpoint");
});
