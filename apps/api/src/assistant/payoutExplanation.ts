import type { Pool } from "pg";
import { bankersRoundDiv, formatBhd, toFils } from "@filspay/money";
import { getSettlementBatch, listBatchTransactions } from "../settlement/query.js";

/**
 * Everything Claude is allowed to say about one payout, computed here in
 * integer fils. Claude only puts these facts into words — it never adds,
 * divides or rounds money itself.
 */
export interface PayoutFacts {
  batchId: string;
  batchDate: string;
  status: "open" | "closed" | "paid" | string;
  statusMeaning: string;
  paymentCount: number;
  partiallyCapturedCount: number;
  grossBhd: string;
  feeBhd: string;
  netPayoutBhd: string;
  /** fee ÷ gross, e.g. "2.50%"; null when gross is 0. */
  effectiveFeeRate: string | null;
  closedAtBahrain: string | null;
  paidAtBahrain: string | null;
  /** Compared with the average gross of up to 7 earlier closed/paid days. */
  comparison: { previousDays: number; averageGrossBhd: string; changePercent: number } | null;
}

function bhd(fils: number): string {
  return `${fils < 0 ? "-" : ""}${formatBhd(toFils(Math.abs(fils)))} BHD`;
}

function bahrainTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Bahrain",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_MEANING: Record<string, string> = {
  open: "The day is still collecting payments. The totals can still grow; nothing has been sent to the bank yet.",
  closed: "The day is closed and the totals are final. The payout has not been marked as sent to the bank yet.",
  paid: "The day is closed and the net payout has been sent to the merchant's bank account.",
};

/** Pure: turns raw integers into display facts. Exported for tests. */
export function buildPayoutFacts(input: {
  batchId: string;
  batchDate: string;
  status: string;
  grossFils: number;
  feeFils: number;
  netPayoutFils: number;
  closedAt: string | null;
  paidAt: string | null;
  paymentCount: number;
  partiallyCapturedCount: number;
  previousGrossFils: number[];
}): PayoutFacts {
  let effectiveFeeRate: string | null = null;
  if (input.grossFils > 0) {
    // Basis points, banker's-rounded, as an integer — then printed with 2 decimals.
    const bps = bankersRoundDiv(BigInt(input.feeFils) * 10_000n, BigInt(input.grossFils));
    effectiveFeeRate = `${Math.trunc(bps / 100)}.${String(bps % 100).padStart(2, "0")}%`;
  }

  let comparison: PayoutFacts["comparison"] = null;
  if (input.previousGrossFils.length > 0) {
    const total = input.previousGrossFils.reduce((a, b) => a + b, 0);
    const avg = bankersRoundDiv(BigInt(total), BigInt(input.previousGrossFils.length));
    comparison = {
      previousDays: input.previousGrossFils.length,
      averageGrossBhd: bhd(avg),
      changePercent: avg > 0 ? bankersRoundDiv(BigInt(input.grossFils - avg) * 100n, BigInt(avg)) : 0,
    };
  }

  return {
    batchId: input.batchId,
    batchDate: input.batchDate,
    status: input.status,
    statusMeaning: STATUS_MEANING[input.status] ?? "Unknown status.",
    paymentCount: input.paymentCount,
    partiallyCapturedCount: input.partiallyCapturedCount,
    grossBhd: bhd(input.grossFils),
    feeBhd: bhd(input.feeFils),
    netPayoutBhd: bhd(input.netPayoutFils),
    effectiveFeeRate,
    closedAtBahrain: bahrainTime(input.closedAt),
    paidAtBahrain: bahrainTime(input.paidAt),
    comparison,
  };
}

/** Loads the facts for one batch, scoped to the merchant. Returns null if
 *  the batch doesn't exist or belongs to another merchant. */
export async function loadPayoutFacts(pool: Pool, merchantId: string, batchId: string): Promise<PayoutFacts | null> {
  const batch = await getSettlementBatch(pool, { merchantId, batchId });
  if (!batch) return null;
  const [lines, previous] = await Promise.all([
    listBatchTransactions(pool, batch.id),
    pool.query<{ gross_fils: string }>(
      `SELECT gross_fils FROM settlement_batches
        WHERE merchant_id = $1 AND batch_date < $2 AND status IN ('closed', 'paid')
        ORDER BY batch_date DESC LIMIT 7`,
      [merchantId, batch.batchDate],
    ),
  ]);
  return buildPayoutFacts({
    batchId: batch.id,
    batchDate: batch.batchDate,
    status: batch.status,
    grossFils: batch.grossFils,
    feeFils: batch.feeFils,
    netPayoutFils: batch.netPayoutFils,
    closedAt: batch.closedAt,
    paidAt: batch.paidAt,
    paymentCount: batch.includedTransactionCount,
    partiallyCapturedCount: lines.filter((l) => l.status === "partially_captured").length,
    previousGrossFils: previous.rows.map((r) => Number(r.gross_fils)),
  });
}

export const PAYOUT_SYSTEM_PROMPT = `You explain one day's payout to a small-business owner in Bahrain, in plain everyday words.

You get a JSON object of facts. Write 2 to 4 short sentences:
1. What happened that day: how many payments and how much was sold (gross).
2. FilsPay's fee and the net amount for the bank, and what the status means for when the money arrives.
3. Only if useful: how the day compares with recent days, or that some payments were only partly taken.

Rules:
- Use only the facts given. Copy amounts exactly as written (they are already in BHD with three decimals). Never calculate, round or convert a number yourself.
- No jargon: say "sold" not "gross", "sent to your bank" not "settled". You may use "fee".
- No greeting, no headings, no bullet points, no advice to contact support unless the status is unknown.`;
