import type { Pool } from "pg";
import { withTransaction } from "../db/withTransaction.js";
import { TooManyRequestsError } from "../lib/errors.js";

export interface AssistantLimits {
  perMinute: number;
  perDay: number;
  /** Tokens (input + output) a merchant may use in 24 h; 0 = no token cap. */
  tokensPerDay?: number;
  /** Tokens one login session may use in 24 h; 0 = no token cap. */
  tokensPerSession?: number;
}

/**
 * Per-merchant budget for the paid AI assistant (ENH-009, tokens: ENH-010).
 * Each call takes a transaction-scoped advisory lock on the merchant, checks
 * its calls in the last minute and day and its tokens in the last day (per
 * merchant and per login session), and records the new call — so parallel
 * requests can't all pass the check, and several API instances share one
 * budget. Returns the call's id so the tokens it uses can be added after.
 */
export async function reserveAssistantCall(
  pool: Pool,
  merchantId: string,
  limits: AssistantLimits,
  sessionKey?: string,
): Promise<string> {
  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('assistant:' || $1, 0))`, [merchantId]);
    await client.query(`DELETE FROM assistant_usage WHERE merchant_id = $1 AND created_at < now() - interval '1 day'`, [
      merchantId,
    ]);
    const usage = await client.query<{
      minute: string;
      day: string;
      day_tokens: string;
      session_tokens: string;
      minute_reset: number | null;
      day_reset: number | null;
    }>(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute')::text AS minute,
              count(*)::text AS day,
              coalesce(sum(tokens), 0)::text AS day_tokens,
              coalesce(sum(tokens) FILTER (WHERE session_key = $2), 0)::text AS session_tokens,
              ceil(extract(epoch FROM min(created_at) FILTER (WHERE created_at > now() - interval '1 minute')
                   + interval '1 minute' - now()))::int AS minute_reset,
              ceil(extract(epoch FROM min(created_at) + interval '1 day' - now()))::int AS day_reset
         FROM assistant_usage
        WHERE merchant_id = $1`,
      [merchantId, sessionKey ?? null],
    );
    const row = usage.rows[0]!;
    const dayReset = Math.max(1, row.day_reset ?? 60);
    if (Number(row.day) >= limits.perDay) {
      throw new TooManyRequestsError("assistant_rate_limited", "Daily assistant limit reached", dayReset);
    }
    if (limits.tokensPerDay && Number(row.day_tokens) >= limits.tokensPerDay) {
      throw new TooManyRequestsError("assistant_token_budget", "Daily assistant usage limit reached", dayReset);
    }
    if (sessionKey && limits.tokensPerSession && Number(row.session_tokens) >= limits.tokensPerSession) {
      throw new TooManyRequestsError(
        "assistant_session_budget",
        "This chat session has reached its limit; sign in again later",
        dayReset,
      );
    }
    if (Number(row.minute) >= limits.perMinute) {
      throw new TooManyRequestsError("assistant_rate_limited", "Too many questions, wait a moment", Math.max(1, row.minute_reset ?? 1));
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO assistant_usage (merchant_id, session_key) VALUES ($1, $2) RETURNING id::text`,
      [merchantId, sessionKey ?? null],
    );
    return inserted.rows[0]!.id;
  });
}

/** Adds the tokens a reserved call actually used (input + output, gate included). */
export async function recordAssistantTokens(pool: Pool, callId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;
  await pool.query(`UPDATE assistant_usage SET tokens = tokens + $2 WHERE id = $1`, [callId, Math.round(tokens)]);
}

/** Tokens this session has used in the last day, for stopping a long tool loop. */
export async function sessionTokensUsed(pool: Pool, merchantId: string, sessionKey: string): Promise<number> {
  const r = await pool.query<{ total: string }>(
    `SELECT coalesce(sum(tokens), 0)::text AS total FROM assistant_usage
      WHERE merchant_id = $1 AND session_key = $2 AND created_at > now() - interval '1 day'`,
    [merchantId, sessionKey],
  );
  return Number(r.rows[0]?.total ?? 0);
}
