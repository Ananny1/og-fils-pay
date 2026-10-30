import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../db/withTransaction.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";

export interface ReplayResult {
  deliveryId: string;
  status: string;
}

export interface OriginalDelivery {
  id: string;
  endpointId: string;
  outboxEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  /** The original row's delivery_event_id; when absent (archive restore) the envelope's own `id` is used. */
  deliveryEventId?: string;
}

/**
 * The single definition of "what does replaying one delivery mean", used by
 * both the merchant-facing single-delivery replay route and the admin
 * batch-replay function — so the two can never mean different things.
 *
 * Re-signs with a fresh timestamp (the dispatcher signs at send time) but
 * keeps the ORIGINAL event's delivery_event_id, in the column (sent as the
 * Webhook-Delivery-Id header) and as the envelope's `id`. That id is the only
 * key a receiver can dedupe on (0022 schema, ARCHITECTURE §5): BUG-104, a
 * replay used to mint a new one, so a receiver that had already processed
 * e.g. `settlement.paid` booked the payout a second time. The replay still
 * gets its own row id, so the original attempt history is kept.
 *
 * The original row (payload + signature) is never mutated — forensic value
 * is preserved there, not by resending its exact bytes.
 *
 * Takes a PoolClient so the caller controls the transaction: the batch path
 * needs every insert and its audit row to commit or roll back together.
 */
export async function insertReplayDeliveryRow(
  client: PoolClient,
  original: OriginalDelivery,
): Promise<ReplayResult> {
  // BUG-104: reuse the original event id (header and envelope) so the
  // receiver can dedupe the replay; only an envelope with no id gets a new one.
  const payloadId = original.payload.id;
  const deliveryEventId =
    original.deliveryEventId ?? (typeof payloadId === "string" && payloadId !== "" ? payloadId : randomUUID());
  const replayPayload = { ...original.payload, id: deliveryEventId };

  const insertResult = await client.query<{ id: string; status: string }>(
    `INSERT INTO webhook_deliveries
        (endpoint_id, outbox_event_id, event_type, delivery_event_id, payload, status, next_attempt_at, replay_of_delivery_id)
     VALUES ($1, $2, $3, $4, $5, 'pending', now(), $6)
     RETURNING id, status`,
    [
      original.endpointId,
      original.outboxEventId,
      original.eventType,
      deliveryEventId,
      JSON.stringify(replayPayload),
      original.id,
    ],
  );
  const row = insertResult.rows[0];
  if (!row) {
    throw new Error("insertReplayDeliveryRow: insert into webhook_deliveries returned no row");
  }
  return { deliveryId: row.id, status: row.status };
}

interface OriginalDeliveryRow {
  id: string;
  endpoint_id: string;
  outbox_event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  delivery_event_id: string;
  endpoint_status: string;
}

/**
 * `POST .../webhook-endpoints/:id/deliveries/:deliveryId/replay` business
 * logic: it validates the
 * three-way ownership predicate and then defers to
 * `insertReplayDeliveryRow` above for the replay itself.
 */
export async function replayWebhookDelivery(
  pool: Pool,
  input: { merchantId: string; endpointId: string; deliveryId: string },
): Promise<ReplayResult> {
  // Three-way predicate (delivery, endpoint, merchant all agree) — a replay
  // can't be aimed at a delivery/endpoint pairing that doesn't actually
  // belong to the caller even if two of the three IDs are individually
  // valid.
  const lookupResult = await pool.query<OriginalDeliveryRow>(
    `SELECT wd.id, wd.endpoint_id, wd.outbox_event_id, wd.event_type, wd.payload, wd.delivery_event_id, we.status AS endpoint_status
       FROM webhook_deliveries wd
       JOIN webhook_endpoints we ON we.id = wd.endpoint_id
      WHERE wd.id = $1 AND wd.endpoint_id = $2 AND we.merchant_id = $3`,
    [input.deliveryId, input.endpointId, input.merchantId],
  );
  const original = lookupResult.rows[0];
  if (!original) {
    throw new NotFoundError("webhook_delivery_not_found");
  }
  if (original.endpoint_status !== "active") {
    throw new ConflictError("endpoint_disabled");
  }

  return withTransaction(pool, async (client) =>
    insertReplayDeliveryRow(client, {
      id: original.id,
      endpointId: original.endpoint_id,
      outboxEventId: original.outbox_event_id,
      eventType: original.event_type,
      payload: original.payload,
      deliveryEventId: original.delivery_event_id,
    }),
  );
}
