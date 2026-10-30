import type { Pool } from "pg";
import { withTransaction } from "../db/withTransaction.js";
import { TooManyRequestsError } from "../lib/errors.js";

/**
 * Per-merchant budget for the paid AI assistant (ENH-009). Each call takes a
 * transaction-scoped advisory lock on the merchant, counts its calls in the
 * last minute and day, and records the new one — so parallel requests can't
 * all pass the count, and several API instances share one budget.
 */
export async function reserveAssistantCall(
  pool: Pool,
  merchantId: string,
  limits: { perMinute: number; perDay: number },
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('assistant:' || $1, 0))`, [merchantId]);
    await client.query(`DELETE FROM assistant_usage WHERE merchant_id = $1 AND created_at < now() - interval '1 day'`, [
      merchantId,
    ]);
    const usage = await client.query<{ minute: string; day: string; minute_reset: number | null; day_reset: number | null }>(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute')::text AS minute,
              count(*)::text AS day,
              ceil(extract(epoch FROM min(created_at) FILTER (WHERE created_at > now() - interval '1 minute')
                   + interval '1 minute' - now()))::int AS minute_reset,
              ceil(extract(epoch FROM min(created_at) + interval '1 day' - now()))::int AS day_reset
         FROM assistant_usage
        WHERE merchant_id = $1`,
      [merchantId],
    );
    const row = usage.rows[0]!;
    if (Number(row.day) >= limits.perDay) {
      throw new TooManyRequestsError("assistant_rate_limited", "Daily assistant limit reached", Math.max(1, row.day_reset ?? 60));
    }
    if (Number(row.minute) >= limits.perMinute) {
      throw new TooManyRequestsError("assistant_rate_limited", "Too many questions, wait a moment", Math.max(1, row.minute_reset ?? 1));
    }
    await client.query(`INSERT INTO assistant_usage (merchant_id) VALUES ($1)`, [merchantId]);
  });
}
