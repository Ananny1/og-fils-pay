import type { QueryableClient } from "@filspay/events";

/**
 * reporting_outbox_cursor read/advance — this consumer's own watermark,
 * never a reuse of outbox_events.processed_at.
 */
export interface ConsumerCursor {
  lastProcessedId: bigint;
  /** BUG-131: xid8 of the last applied row's writer, as text. */
  lastProcessedTxid: string;
}

/**
 * last_processed_id is BIGINT; pg returns it as a string, hence the union.
 */
interface CursorRow {
  last_processed_id: string | number;
  last_processed_txid: string;
}

/**
 * Seeds the row on first ever run (INSERT ... ON CONFLICT DO NOTHING),
 * then reads it. Never throws on a missing row — a worker's first pass
 * against a fresh database always starts from 0.
 */
// BUG-130: FOR UPDATE so a second pass (catch-up beside the worker) waits for the first to commit and then sees its new watermark. The `running` flag only guards passes inside one process.
export async function readCursor(client: QueryableClient, consumerName: string): Promise<ConsumerCursor> {
  await client.query(
    `INSERT INTO reporting_outbox_cursor (consumer_name, last_processed_id)
     VALUES ($1, 0)
     ON CONFLICT (consumer_name) DO NOTHING`,
    [consumerName],
  );

  const result = (await client.query(`SELECT last_processed_id, last_processed_txid::text AS last_processed_txid FROM reporting_outbox_cursor WHERE consumer_name = $1 FOR UPDATE`, [
    consumerName,
  ])) as { rows: CursorRow[] };

  const row = result.rows[0];
  return {
    lastProcessedId: row ? BigInt(row.last_processed_id) : 0n,
    lastProcessedTxid: row ? row.last_processed_txid : "0",
  };
}

// YA: absolute SET is fine, only one writer.
export async function advanceCursor(
  client: QueryableClient,
  consumerName: string,
  newLastProcessedId: bigint,
  newLastProcessedTxid: string,
): Promise<void> {
  await client.query(
    `UPDATE reporting_outbox_cursor
        SET last_processed_id = $2, last_processed_txid = $3::xid8, updated_at = now()
      WHERE consumer_name = $1`,
    [consumerName, newLastProcessedId.toString(), newLastProcessedTxid],
  );
}

/** Resets this consumer's watermark to 0 — used only by the `rebuild`
 *  subcommand (cli/rebuild.ts) before replaying the entire outbox history. */
// MK: rebuild only. never call from the worker.
export async function resetCursor(client: QueryableClient, consumerName: string): Promise<void> {
  await client.query(
    `INSERT INTO reporting_outbox_cursor (consumer_name, last_processed_id, updated_at)
     VALUES ($1, 0, now())
     ON CONFLICT (consumer_name) DO UPDATE SET last_processed_id = 0, last_processed_txid = '0', updated_at = now()`,
    [consumerName],
  );
}
