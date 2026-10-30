import type { Pool } from "pg";
import { bahrainBusinessDate, businessDayHasEnded, businessDayStart } from "./businessDay.js";

/**
 * The admin "Payout days" panel (FP-301).
 *
 * A settlement business day runs midnight to midnight Asia/Bahrain (UTC+3, no
 * DST); the date helpers and the reason a running day cannot be closed
 * (BUG-088) are in ./businessDay.ts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** `date` shifted by whole days, as `YYYY-MM-DD`. */
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export type SettlementDayStatus =
  /** Today: still taking payments; cannot be closed yet. */
  | "running"
  /** Over, and has sales no batch has claimed yet: close it. */
  | "needs_closing"
  /** Closed but at least one shop's batch is not paid out. */
  | "closed_unpaid"
  /** Over, every batch paid (or nothing to pay). */
  | "done";

export interface SettlementDayDto {
  businessDate: string;
  status: SettlementDayStatus;
  /** Sales in this day's window that no batch has claimed yet (before fees). */
  waitingFils: number;
  waitingMerchantCount: number;
  /** Totals of the batches already closed or paid for this date. */
  batchCount: number;
  paidBatchCount: number;
  grossFils: number;
  feeFils: number;
  netPayoutFils: number;
}

export function dayStatus(input: {
  ended: boolean;
  waitingFils: number;
  batchCount: number;
  paidBatchCount: number;
}): SettlementDayStatus {
  if (!input.ended) return "running";
  if (input.waitingFils > 0) return "needs_closing";
  if (input.paidBatchCount < input.batchCount) return "closed_unpaid";
  return "done";
}

/**
 * The last `days` business days, newest first. Two grouped queries, both
 * bounded to the date range: batches by `batch_date` (index from 0099) and
 * unclaimed capture events by Bahrain day (partial index
 * `idx_transaction_events_unbatched`).
 */
export async function listSettlementDays(pool: Pool, now: Date, days = 7): Promise<SettlementDayDto[]> {
  const today = bahrainBusinessDate(now);
  const oldest = addDays(today, -(days - 1));
  const windowStart = businessDayStart(oldest);
  const windowEnd = new Date(businessDayStart(today).getTime() + DAY_MS);

  const [batches, waiting] = await Promise.all([
    pool.query<{ d: string; batches: string; paid: string; gross: string; fee: string; net: string }>(
      `SELECT batch_date::text AS d,
              count(*) FILTER (WHERE status IN ('closed', 'paid')) AS batches,
              count(*) FILTER (WHERE status = 'paid') AS paid,
              coalesce(sum(gross_fils) FILTER (WHERE status IN ('closed', 'paid')), 0) AS gross,
              coalesce(sum(fee_fils) FILTER (WHERE status IN ('closed', 'paid')), 0) AS fee,
              coalesce(sum(net_payout_fils) FILTER (WHERE status IN ('closed', 'paid')), 0) AS net
         FROM settlement_batches
        WHERE batch_date BETWEEN $1::date AND $2::date
        GROUP BY batch_date`,
      [oldest, today],
    ),
    pool.query<{ d: string; merchants: string; amount: string }>(
      `SELECT (te.occurred_at AT TIME ZONE 'Asia/Bahrain')::date::text AS d,
              count(DISTINCT t.merchant_id) AS merchants,
              coalesce(sum(te.amount_fils), 0) AS amount
         FROM transaction_events te
         JOIN transactions t ON t.id = te.transaction_id
        WHERE te.settlement_batch_id IS NULL
          AND te.event_type IN ('captured', 'partially_captured')
          AND te.occurred_at >= $1 AND te.occurred_at < $2
        GROUP BY 1`,
      [windowStart, windowEnd],
    ),
  ]);

  const byBatchDate = new Map(batches.rows.map((r) => [r.d, r]));
  const byWaitingDate = new Map(waiting.rows.map((r) => [r.d, r]));

  const result: SettlementDayDto[] = [];
  for (let i = 0; i < days; i++) {
    const businessDate = addDays(today, -i);
    const b = byBatchDate.get(businessDate);
    const w = byWaitingDate.get(businessDate);
    const day = {
      businessDate,
      waitingFils: Number(w?.amount ?? 0),
      waitingMerchantCount: Number(w?.merchants ?? 0),
      batchCount: Number(b?.batches ?? 0),
      paidBatchCount: Number(b?.paid ?? 0),
      grossFils: Number(b?.gross ?? 0),
      feeFils: Number(b?.fee ?? 0),
      netPayoutFils: Number(b?.net ?? 0),
    };
    result.push({
      ...day,
      status: dayStatus({ ended: businessDayHasEnded(businessDate, now), ...day }),
    });
  }
  return result;
}
