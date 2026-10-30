import type { Pool } from "pg";
import { insertAdminAuditLog } from "../adminAudit/log.js";
import { withTransaction } from "../db/withTransaction.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { insertReplayDeliveryRow } from "./replay.js";

/** Same batch-cap idea as the dispatcher's own pass caps: a bounded unit
 *  of work per call, so one operator click can never open a transaction that
 *  holds locks for an unbounded time. */
/**
 * Hard cap per request. — YA: finance's favourite button.
 */
const MAX_BATCH_SIZE = 500;

/** The one truly terminal failure state the dispatcher itself produces.
 *  `pending`/`succeeded`/`failed` are accepted if a caller explicitly asks
 *  for them — deliberately resending a `succeeded` delivery is a legitimate,
 *  if unusual, operator action — but they are never the default. */
// support can pass status=succeeded and replay everything — am
// MK: the route rejects succeeded
export const DEFAULT_REPLAY_STATUSES = ["exhausted"] as const;

export interface BatchReplayResult {
  matchedCount: number;
  replayedDeliveryIds: string[];
}

/**
 * "Replay a batch" = every delivery for one endpoint, in one date range,
 * with one of the requested statuses — replayed by calling the *same*
 * single-delivery replay logic in a loop. Deliberately not a second
 * delivery/retry engine: `insertReplayDeliveryRow` is the only definition of
 * what a replay is, here as in the merchant-facing route.
 *
 * Candidate selection, every replay insert, and the audit row all happen
 * inside **one** transaction. That makes an audit-write failure roll back the
 * entire batch atomically — there is no state in which 400 deliveries were
 * requeued and no record says who asked for it. It is safe to hold this in a
 * transaction because every statement in it is a plain DB insert: no outbound
 * HTTP happens here. The actual deliveries are sent later, asynchronously, by
 * the existing dispatcher's normal poll/NOTIFY pass, exactly as they are for
 * a single replay.
 */
export async function replayWebhookDeliveriesBatch(
  pool: Pool,
  input: {
    merchantId: string;
    endpointId: string;
    adminUserId: string;
    from: Date;
    to: Date;
    statuses: string[];
  },
): Promise<BatchReplayResult> {
  return withTransaction(pool, async (client) => {
    // Merchant-scoped endpoint predicate, exactly like the merchant-facing
    // replay route's: an admin acting on a merchant's behalf gets the same
    // ownership check, not a looser one.
    const endpoint = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM webhook_endpoints WHERE id = $1 AND merchant_id = $2`,
      [input.endpointId, input.merchantId],
    );
    const endpointRow = endpoint.rows[0];
    if (!endpointRow) {
      throw new NotFoundError("webhook_endpoint_not_found");
    }
    if (endpointRow.status !== "active") {
      throw new ConflictError("endpoint_disabled");
    }

    const candidates = await client.query<{
      id: string;
      endpoint_id: string;
      outbox_event_id: string;
      event_type: string;
      payload: Record<string, unknown>;
    }>(
      // BUG-087: every replay row gets a NEW delivery id (replay.ts), so the
      // receiver cannot dedupe a second copy. Queue each event at most once
      // (latest matching row per outbox event), never for an event already
      // pending on this endpoint (a second click), and never for one already
      // delivered unless the caller explicitly asked for 'succeeded' rows.
      `SELECT id, endpoint_id, outbox_event_id, event_type, payload
         FROM (
           SELECT DISTINCT ON (wd.outbox_event_id)
                  wd.id, wd.endpoint_id, wd.outbox_event_id, wd.event_type, wd.payload, wd.created_at
             FROM webhook_deliveries wd
            WHERE wd.endpoint_id = $1 AND wd.status = ANY($2)
              AND wd.created_at >= $3 AND wd.created_at < $4
              AND NOT EXISTS (
                SELECT 1 FROM webhook_deliveries o
                 WHERE o.endpoint_id = wd.endpoint_id
                   AND o.outbox_event_id = wd.outbox_event_id
                   AND (o.status = 'pending' OR (o.status = 'succeeded' AND NOT 'succeeded' = ANY($2)))
              )
            ORDER BY wd.outbox_event_id, wd.created_at DESC
         ) latest
        ORDER BY created_at ASC
        LIMIT $5`,
      [input.endpointId, input.statuses, input.from, input.to, MAX_BATCH_SIZE],
    );

    const replayedDeliveryIds: string[] = [];
    for (const row of candidates.rows) {
      const inserted = await insertReplayDeliveryRow(client, {
        id: row.id,
        endpointId: row.endpoint_id,
        outboxEventId: row.outbox_event_id,
        eventType: row.event_type,
        payload: row.payload,
      });
      replayedDeliveryIds.push(inserted.deliveryId);
    }

    await insertAdminAuditLog(client, {
      adminUserId: input.adminUserId,
      action: "webhook_batch_replay",
      targetType: "webhook_endpoint",
      targetId: input.endpointId,
      metadata: {
        merchantId: input.merchantId,
        from: input.from.toISOString(),
        to: input.to.toISOString(),
        statuses: input.statuses,
        replayedDeliveryIds,
      },
    });

    return { matchedCount: candidates.rows.length, replayedDeliveryIds };
  });
}
