/**
 * BUG-081: restoring a webhook delivery archive must send each event at most
 * once to the target endpoint. An archive holds every delivery ROW in its
 * range (an original and each of its replays), and every replay row gets a
 * new delivery id, so before the fix the target received the same event once
 * per archived row, and again on every repeated restore.
 * Requires DATABASE_URL (migrated Postgres).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createWebhookDeliveryArchive, replayWebhookDeliveryArchive } from "./archiveReplay.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("archiveReplay.new.test.ts requires DATABASE_URL");

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
test.after(async () => {
  await pool.end();
});

const WINDOW = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-05-10T00:00:00Z") };

async function one<T>(sql: string, params: unknown[]): Promise<T> {
  return (await pool.query(sql, params)).rows[0] as T;
}

test("BUG-081: an archive holding an original and its replay restores the event once, and only once", async () => {
  const { id: merchantId } = await one<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`BUG-081 ${randomUUID()}`],
  );
  const { id: adminUserId } = await one<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role)
     VALUES ($1, 'not-a-real-hash', 'BUG-081', 'finance') RETURNING id`,
    [`bug-088-${randomUUID()}@admin.test`],
  );
  const endpoint = (url: string) =>
    one<{ id: string }>(
      `INSERT INTO webhook_endpoints (merchant_id, url, secret_ciphertext, secret_prefix, created_by_type, created_by_id)
       VALUES ($1, $2, 'unused', 'whsec_testpre', 'merchant_session', $3) RETURNING id`,
      [merchantId, url, randomUUID()],
    );
  const source = await endpoint(`https://old.test/${randomUUID()}`);
  const target = await endpoint(`https://new.test/${randomUUID()}`);

  const { id: outboxEventId } = await one<{ id: string }>(
    `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload, processed_at)
     VALUES ('archive.test.replay_fixture', 'transaction', $1, '{}'::jsonb, now()) RETURNING id`,
    [randomUUID()],
  );
  const { id: originalId } = await one<{ id: string }>(
    `INSERT INTO webhook_deliveries (endpoint_id, outbox_event_id, event_type, delivery_event_id, payload, status, created_at)
     VALUES ($1, $2, 'transaction.captured', $3, '{}'::jsonb, 'exhausted', '2026-05-02T00:00:00Z') RETURNING id`,
    [source.id, outboxEventId, randomUUID()],
  );
  await pool.query(
    `INSERT INTO webhook_deliveries
        (endpoint_id, outbox_event_id, event_type, delivery_event_id, payload, status, replay_of_delivery_id, created_at)
     VALUES ($1, $2, 'transaction.captured', $3, '{}'::jsonb, 'succeeded', $4, '2026-05-03T00:00:00Z')`,
    [source.id, outboxEventId, randomUUID(), originalId],
  );

  const archive = await createWebhookDeliveryArchive(pool, { merchantId, endpointId: source.id, adminUserId, ...WINDOW });
  assert.equal(archive.deliveryCount, 2, "the archive keeps both rows (complete audit record)");

  const restore = () =>
    replayWebhookDeliveryArchive(pool, { merchantId, archiveId: archive.archiveId, targetEndpointId: target.id, adminUserId });

  const first = await restore();
  assert.equal(first.replayedCount, 1, "one event -> one delivery on the new endpoint");
  const second = await restore();
  assert.equal(second.replayedCount, 0, "restoring again does not queue the event a second time");

  const { n } = await one<{ n: string }>(
    `SELECT count(*)::text AS n FROM webhook_deliveries WHERE endpoint_id = $1 AND outbox_event_id = $2`,
    [target.id, outboxEventId],
  );
  assert.equal(Number(n), 1);
});
