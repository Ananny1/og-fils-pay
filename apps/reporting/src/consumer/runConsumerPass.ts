import type { Pool } from "pg";
import type { EventType } from "@filspay/events";
import { withTransaction } from "../db/withTransaction.js";
import type { ReportingConfig } from "../config.js";
import { readCursor, advanceCursor } from "./cursor.js";
import { applyEvent, type OutboxEventRow } from "./applyEvent.js";

// Every type here must have a case in applyEvent's switch first, or its
// default branch throws and the whole pass (every merchant) stalls.
export const REPORTING_EVENT_TYPES: readonly EventType[] = [
  "transaction.captured",
  "transaction.voided",
  "settlement.batch_closed",
  "refund.succeeded",
];

/**
 * Keys this worker's row in reporting_outbox_cursor. Two processes using the
 * same name serialize on that row, so a catch-up run beside a live worker
 * cannot apply an event twice.
 */
export const CONSUMER_NAME = "reporting";

/**
 * The one function both the NOTIFY handler and the poll timer call.
 * Everything — the read of due outbox_events, every rollup
 * upsert `applyEvent` performs, and the watermark advance — happens inside
 * one `withTransaction` call: either the whole batch of up-to-
 * `consumerBatchLimit` events is applied *and* the watermark moves past all
 * of them, atomically, or (on any error) nothing in this pass is applied
 * and the watermark is untouched — the next pass simply re-selects the
 * identical event range and retries. This is the exact property that makes
 * the watermark alone sufficient for exactly-once application, with no
 * separate per-event dedup table the way webhook_deliveries needs one.
 *
 * The `SELECT` below is a plain, unlocked read — no row lock, no
 * `FOR UPDATE`, no mutation of any outbox_events column — identical
 * posture to webhooks/dispatcher.ts's Step A.
 */
export async function runConsumerPass(
  pool: Pool,
  config: Pick<ReportingConfig, "consumerBatchLimit">,
): Promise<{ processedCount: number }> {
  return withTransaction(pool, async (client) => {
    const cursor = await readCursor(client, CONSUMER_NAME);

    // BUG-096: ids are assigned at INSERT, not at COMMIT, so walking by id
    // alone skips a slow transaction's lower id forever. Walk in
    // (txid, id) order instead, and only over rows whose writer finished
    // before the oldest still-running transaction: those rows are final and
    // nothing can later appear before them.
    const eventsResult = await client.query<OutboxEventRow & { txid: string }>(
      `SELECT id, event_type, aggregate_id, payload, created_at, txid::text AS txid
         FROM outbox_events
        WHERE (txid, id) > ($1::xid8, $2::bigint)
          AND txid < pg_snapshot_xmin(pg_current_snapshot())
          AND event_type = ANY($3::text[])
        ORDER BY txid ASC, id ASC
        LIMIT $4`,
      [cursor.lastProcessedTxid, cursor.lastProcessedId.toString(), REPORTING_EVENT_TYPES, config.consumerBatchLimit],
    );

    for (const row of eventsResult.rows) {
      await applyEvent(client, row);
    }

    const last = eventsResult.rows[eventsResult.rows.length - 1];
    if (last) {
      await advanceCursor(client, CONSUMER_NAME, BigInt(last.id), last.txid);
    }

    return { processedCount: eventsResult.rows.length };
  });
}
