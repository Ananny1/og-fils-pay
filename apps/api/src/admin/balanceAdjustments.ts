import type { Pool } from "pg";
import { toFils, type Fils } from "@filspay/money";
import { insertAdminAuditLog } from "../adminAudit/log.js";
import { withTransaction } from "../db/withTransaction.js";
import { ConflictError, NotFoundError, UnprocessableEntityError } from "../lib/errors.js";
import { claimIdempotencyKey, completeIdempotencyKey, hashRequest } from "../payments/idempotency.js";
import { postLedgerAdjustment } from "./ledgerAdjustments.js";

export interface BalanceAdjustmentInput {
  merchantId: string;
  adminUserId: string;
  /** A correction can go either way, so this is a signed delta. */
  deltaFils: Fils;
  reason: string;
  /** BUG-109: optional client Idempotency-Key; only applyBalanceCorrection honours it. */
  idempotencyKey?: string;
}

/** Before/after are read under the same row lock as the UPDATE, so the pair is exact. */
export interface BalanceAdjustmentResult {
  merchantId: string;
  deltaFils: Fils;
  cachedPayableFilsBefore: Fils;
  cachedPayableFilsAfter: Fils;
}

/** Applies a correction to a merchant's balance record and audits it. */
export async function applyBalanceCorrection(
  pool: Pool,
  input: BalanceAdjustmentInput,
): Promise<BalanceAdjustmentResult> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{ cached_payable_fils: string }>(
      `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1 FOR UPDATE`,
      [input.merchantId],
    );
    const row = existing.rows[0];
    if (!row) {
      throw new NotFoundError("merchant_balance_not_found");
    }
    const before = toFils(Number(row.cached_payable_fils), { allowNegative: true });

    // BUG-109: claimed after the row lock (so the merchant exists for the FK);
    // a double submit with the same key replays the first answer instead of
    // moving the balance again. Scoped per admin and merchant.
    let claimId: string | null = null;
    if (input.idempotencyKey !== undefined) {
      const claim = await claimIdempotencyKey(client, {
        merchantId: input.merchantId,
        endpoint: `admin.balance_adjustments:${input.adminUserId}`,
        key: input.idempotencyKey,
        requestHash: hashRequest({ deltaFils: input.deltaFils, reason: input.reason }),
      });
      if (claim.outcome === "conflict_hash_mismatch") {
        throw new UnprocessableEntityError("idempotency_key_reused");
      }
      if (claim.outcome === "conflict_in_progress") {
        throw new ConflictError("request_in_progress");
      }
      if (claim.outcome === "replay") {
        return claim.row.responseBody as BalanceAdjustmentResult;
      }
      claimId = claim.row.id;
    }

    const updated = await client.query<{ cached_payable_fils: string }>(
      `UPDATE merchant_balances
          SET cached_payable_fils = cached_payable_fils + $2, updated_at = now()
        WHERE merchant_id = $1
      RETURNING cached_payable_fils`,
      [input.merchantId, input.deltaFils],
    );
    const after = toFils(Number(updated.rows[0]!.cached_payable_fils), { allowNegative: true });

    await insertAdminAuditLog(client, {
      adminUserId: input.adminUserId,
      action: "balance_adjustment",
      targetType: "merchant",
      targetId: input.merchantId,
      metadata: { deltaFils: input.deltaFils, reason: input.reason, before, after },
    });

    const result: BalanceAdjustmentResult = {
      merchantId: input.merchantId,
      deltaFils: input.deltaFils,
      cachedPayableFilsBefore: before,
      cachedPayableFilsAfter: after,
    };
    if (claimId !== null) {
      await completeIdempotencyKey(client, claimId, { statusCode: 200, body: result });
    }
    return result;
  });
}

/** Journaled variant: posts ledger legs alongside the cache correction. */
export async function adjustMerchantBalanceJournaled(
  pool: Pool,
  input: BalanceAdjustmentInput,
): Promise<BalanceAdjustmentResult> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{ cached_payable_fils: string }>(
      `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1 FOR UPDATE`,
      [input.merchantId],
    );
    const row = existing.rows[0];
    if (!row) {
      throw new NotFoundError("merchant_balance_not_found");
    }
    const before = toFils(Number(row.cached_payable_fils), { allowNegative: true });

    const entryGroupId = await postLedgerAdjustment(client, input.merchantId, input.deltaFils);

    const updated = await client.query<{ cached_payable_fils: string }>(
      `UPDATE merchant_balances
          SET cached_payable_fils = cached_payable_fils + $2, updated_at = now()
        WHERE merchant_id = $1
      RETURNING cached_payable_fils`,
      [input.merchantId, input.deltaFils],
    );
    const after = toFils(Number(updated.rows[0]!.cached_payable_fils), { allowNegative: true });

    await insertAdminAuditLog(client, {
      adminUserId: input.adminUserId,
      action: "balance_adjustment_journaled",
      targetType: "merchant",
      targetId: input.merchantId,
      metadata: {
        deltaFils: input.deltaFils,
        reason: input.reason,
        entryGroupId,
        before,
        after,
      },
    });

    return {
      merchantId: input.merchantId,
      deltaFils: input.deltaFils,
      cachedPayableFilsBefore: before,
      cachedPayableFilsAfter: after,
    };
  });
}
