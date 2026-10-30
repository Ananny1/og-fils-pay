import type { Pool } from "pg";

/**
 * Operational record of a payout-rail instruction for a settlement batch.
 * Exactly one per batch (BUG-008): the dispatcher calls this on the first
 * attempt of every delivery row (one per endpoint, maybe from two replicas),
 * so the unique index from migration 0085 + ON CONFLICT makes repeats a no-op.
 */
export async function recordPayoutDisbursementEffect(
  pool: Pool,
  settlementBatchId: string,
  amountFils: number,
): Promise<void> {
  if (amountFils <= 0) {
    // Void batches (zero or negative net) carry no payout instruction.
    return;
  }

  await pool.query(
    `INSERT INTO settlement_payout_disbursements (settlement_batch_id, amount_fils, disbursement_reference)
     VALUES ($1, $2, 'disb_' || gen_random_uuid())
     ON CONFLICT (settlement_batch_id) DO NOTHING`,
    [settlementBatchId, amountFils],
  );
}
