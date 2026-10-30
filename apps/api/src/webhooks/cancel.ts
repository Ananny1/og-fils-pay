import type { Pool } from "pg";
import { withTransaction } from "../db/withTransaction.js";

/** "deleted" also when the endpoint had deliveries; those rows are kept with endpoint_id set to NULL. */
export type DeleteWebhookEndpointResult = "deleted" | "not_found";

/**
 * `DELETE /v1/merchants/:merchantId/webhook-endpoints/:id` business logic.
 * The statement carries the merchant-scoped predicate, never `id` alone. A hard
 * delete, not a status flip — `PATCH .../status: 'disabled'` (update.ts) is
 * the separate tool for "pause without losing history." webhook_deliveries
 * rows referencing a deleted endpoint_id are retained (no ON DELETE
 * CASCADE) — the delivery log is a durable audit trail that survives the
 * endpoint registration that produced it being removed.
 *
 * BUG-085: the FK had no ON DELETE action, so this 500'd for any endpoint
 * with deliveries (the "SET NULL (0029)" note was false). Migration 0106 makes
 * it ON DELETE SET NULL; pending retries are closed as 'failed' first so no
 * row is left queued for an endpoint that no longer exists.
 */
export async function deleteWebhookEndpoint(
  pool: Pool,
  input: { merchantId: string; id: string },
): Promise<DeleteWebhookEndpointResult> {
  return withTransaction(pool, async (client) => {
    const found = await client.query<{ id: string }>(
      `SELECT id FROM webhook_endpoints WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [input.id, input.merchantId],
    );
    if (!found.rows[0]) return "not_found";

    await client.query(
      `UPDATE webhook_deliveries
          SET status = 'failed', response_body_excerpt = 'not sent: webhook endpoint was deleted'
        WHERE endpoint_id = $1 AND status = 'pending'`,
      [input.id],
    );
    await client.query(`DELETE FROM webhook_endpoints WHERE id = $1 AND merchant_id = $2`, [
      input.id,
      input.merchantId,
    ]);
    return "deleted";
  });
}
