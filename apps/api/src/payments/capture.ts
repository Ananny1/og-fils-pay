import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ZERO_FILS, addFils, applyRateFils, compareFils, subtractFils, toFils, type Fils } from "@filspay/money";
import { enqueueEvent } from "@filspay/events";
import { withTransaction } from "../db/withTransaction.js";
import type { AcquirerSimulator } from "../acquirer/types.js";
import { claimIdempotencyKey, completeIdempotencyKey, failIdempotencyKey, hashRequest } from "./idempotency.js";
import { recordTransactionEvent } from "../transactions/events.js";
import { serializeTransaction, type TransactionRow } from "../transactions/serialize.js";
import { ConflictError, UnprocessableEntityError } from "../lib/errors.js";
import { getEffectiveMdrBps } from "../fees/feeSchedule.js";
import { getVolumeTierBonusBps } from "../fees/platformVolumeTier.js";

// BUG-037: a never-called recordCaptureMetric() used to live here. It wrote
// merchant_daily_volume bucketed by UTC date (toISOString().slice(0, 10)).
// That table is owned by the reporting consumer (apps/reporting
// applyEvent.ts), which buckets transaction.captured events by Asia/Bahrain
// date; writing it from capture as well would double-count and put
// 21:00-24:00 UTC captures on the wrong day. Removed rather than wired in.

const ENDPOINT = "transactions.capture";

export interface CaptureInput {
  transactionId: string;
  merchantId: string;
  amountFils?: Fils; // omitted => capture the full remaining amount
  idempotencyKey: string;
  /** Includes 'system' (matching AuthorizeInput.actor and
   *  RecordTransactionEventInput.actor.type) so the payment-link checkout
   *  handler — which has no merchant session or API key of its own — can
   *  call captureTransaction() directly. routes/transactions.ts's capture
   *  route always supplies a real session/API-key actor. */
  actor: { type: "merchant_session" | "merchant_api_key" | "system"; id: string };
  /** Payment-link checkout only (BUG-005). The capture runs only while this
   *  reservation still owns the link, checked under a row lock on the link
   *  that is held through the acquirer call; the link is marked paid in the
   *  same database transaction as the capture. */
  paymentLink?: { id: string; reservationId: string };
}

export interface CaptureResult {
  statusCode: number;
  body: unknown;
}

interface LockedTransactionRow {
  id: string;
  merchant_id: string;
  status: string;
  amount_fils: string | number;
  captured_fils: string | number;
  refunded_fils: string | number;
  acquirer_reference: string;
}

/**
 * `POST /v1/transactions/:id/capture` business logic. Integer math,
 * double-entry journaling, row-locked, idempotent.
 *
 * The central decision: the `SELECT ... FOR UPDATE` row lock is acquired
 * *before* any validation and held through the awaited acquirer call,
 * released only at COMMIT/ROLLBACK (via `withTransaction`). This eliminates
 * the TOCTOU gap by construction — no other transaction can acquire a
 * conflicting lock on this row (not a second capture, not a void, not
 * anything) until this one ends, so there is never a window where "what was
 * validated" and "what gets written" can have diverged.
 *
 * — YA: held across the call on purpose. i was asked why more than once.
 */
export async function captureTransaction(
  pool: Pool | PoolClient,
  acquirer: AcquirerSimulator,
  input: CaptureInput,
): Promise<CaptureResult> {
  // BUG-080: the transaction is part of the request. Without it, a key reused
  // on another transaction replayed the first one's 200 and captured nothing.
  const requestHash = hashRequest({ transactionId: input.transactionId, amountFils: input.amountFils ?? null });

  return withTransaction(pool, async (client) => {
    const claim = await claimIdempotencyKey(client, {
      merchantId: input.merchantId,
      endpoint: ENDPOINT,
      key: input.idempotencyKey,
      requestHash,
    });

    if (claim.outcome === "conflict_hash_mismatch") {
      throw new UnprocessableEntityError("idempotency_key_reused");
    }
    if (claim.outcome === "conflict_in_progress") {
      throw new ConflictError("request_in_progress");
    }
    if (claim.outcome === "replay") {
      // No row lock is ever taken on this call.
      return { statusCode: claim.row.responseStatusCode ?? 200, body: claim.row.responseBody };
    }
    // 'fresh' / 'retry_after_failure' — continue.

    // Acquire the row lock FIRST, before any validation. Ownership is
    // enforced by input.merchantId, which the caller derives only from
    // request.merchantAuth — never from a merchantId in the request body —
    // so ownership can never be satisfied by a value the caller controls
    // independently of how they authenticated.
    const lockResult = await client.query<LockedTransactionRow>(
      `SELECT id, merchant_id, status, amount_fils, captured_fils, refunded_fils, acquirer_reference
         FROM transactions
        WHERE id = $1 AND merchant_id = $2
        FOR UPDATE`,
      [input.transactionId, input.merchantId],
    );
    const txn = lockResult.rows[0];
    if (!txn) {
      const body = { error: "transaction_not_found" };
      await completeIdempotencyKey(client, claim.row.id, { statusCode: 404, body });
      return { statusCode: 404, body };
    }

    // Validate current state, still holding the lock, before calling the
    // acquirer.
    if (txn.status !== "authorized" && txn.status !== "partially_captured") {
      const body = { error: "not_capturable", status: txn.status };
      await completeIdempotencyKey(client, claim.row.id, { statusCode: 409, body });
      return { statusCode: 409, body };
    }

    // — YA: authorised vs captured. finance says "amount" and means both.
    const amountAuthorized = toFils(Number(txn.amount_fils));
    const capturedSoFar = toFils(Number(txn.captured_fils));
    const remaining = subtractFils(amountAuthorized, capturedSoFar);
    const requestedAmount = input.amountFils ?? remaining;

    if (compareFils(requestedAmount, ZERO_FILS) <= 0 || compareFils(requestedAmount, remaining) > 0) {
      const body = { error: "capture_exceeds_remaining", remainingFils: remaining };
      await completeIdempotencyKey(client, claim.row.id, { statusCode: 422, body });
      return { statusCode: 422, body };
    }

    const merchantResult = await client.query<{ mdr_bps: number; negotiated_discount_bps: number }>(
      `SELECT mdr_bps, negotiated_discount_bps FROM merchants WHERE id = $1`,
      [input.merchantId],
    );
    const merchant = merchantResult.rows[0];
    if (!merchant) {
      throw new Error("captureTransaction: merchant row disappeared mid-transaction");
    }

    // Fee rate resolution: effective-dated (apps/api/src/fees/feeSchedule.ts),
    // falling back to this merchant's plain mdr_bps when no schedule row
    // applies yet — the ordinary case for every merchant that has never had
    // a negotiated rate change recorded. Resolved at the instant of capture,
    // inside the same locked transaction that computes and journals the fee.
    const effectiveMdrBps = await getEffectiveMdrBps(client, input.merchantId, new Date(), merchant.mdr_bps);
    const volumeTierBonusBps = await getVolumeTierBonusBps(client);

    // BUG-005: a payment-link capture may only proceed while its own
    // reservation still holds the link. The FOR UPDATE lock is kept through
    // the acquirer call, so a second payer's claim UPDATE waits for us and
    // then sees 'paid'; a payer whose reservation was taken over stops here,
    // before any money moves.
    if (input.paymentLink) {
      const linkResult = await client.query<{ status: string; reservation_id: string | null }>(
        `SELECT status, reservation_id FROM payment_links WHERE id = $1 FOR UPDATE`,
        [input.paymentLink.id],
      );
      const linkRow = linkResult.rows[0];
      if (!linkRow || linkRow.status !== "reserved" || linkRow.reservation_id !== input.paymentLink.reservationId) {
        const body = { error: "payment_link_reservation_lost", linkStatus: linkRow?.status ?? null };
        await completeIdempotencyKey(client, claim.row.id, { statusCode: 409, body });
        return { statusCode: 409, body };
      }
    }

    // Call the acquirer — awaited here, with the row lock from above still
    // held (same client, same open transaction). No other process can
    // read-lock, write-lock, or update this transaction row while this
    // call is in flight.
    const acquirerResult = await acquirer.capture({
      acquirerReference: txn.acquirer_reference,
      amountFils: requestedAmount,
      idempotencyKey: `${claim.row.id}:${claim.row.attemptCount}`,
    });

    if (acquirerResult.outcome === "declined") {
      // Note: AcquirerCaptureResult carries no
      // declineReason field the way AcquirerAuthorizeResult does — capture
      // declines are reported by outcome alone.
      const body = { error: "card_captured_declined" };
      await completeIdempotencyKey(client, claim.row.id, { statusCode: 402, body });
      return { statusCode: 402, body };
    }
    if (acquirerResult.outcome === "error") {
      const body = { error: "acquirer_unavailable" };
      await failIdempotencyKey(client, claim.row.id, { statusCode: 502, body });
      return { statusCode: 502, body };
    }

    // outcome === 'approved'. Integer math throughout — no float ever
    // enters this path.
    // BUG-036: same order as apps/settlement's ComputeSettlementFee
    // (discounted_fee.go): the negotiated discount comes off the amount,
    // then MDR applies, so the ledger fee equals the batch fee to the fils.
    const discountBps = merchant.negotiated_discount_bps;
    const discountedAmount = subtractFils(requestedAmount, applyRateFils(requestedAmount, discountBps));
    const feeFils = applyRateFils(discountedAmount, Math.max(0, effectiveMdrBps - volumeTierBonusBps));
    const newCapturedFils = addFils(capturedSoFar, requestedAmount);
    const fullyCaptured = compareFils(newCapturedFils, amountAuthorized) === 0;
    // BUG-084: a sale already partly refunded stays partially_refunded when
    // its last capture lands; plain "captured" hid the refund.
    const newStatus = !fullyCaptured
      ? "partially_captured"
      : Number(txn.refunded_fils) > 0
        ? "partially_refunded"
        : "captured";

    const updateResult = await client.query<TransactionRow>(
      `UPDATE transactions SET status = $2, captured_fils = $3 WHERE id = $1 RETURNING *`,
      [txn.id, newStatus, newCapturedFils],
    );
    const updatedTxn = updateResult.rows[0];
    if (!updatedTxn) {
      throw new Error("captureTransaction: update to transactions returned no row");
    }

    if (input.paymentLink) {
      // Still holding the link row lock taken above, so this always matches.
      await client.query(
        `UPDATE payment_links
            SET status = 'paid', paid_at = now(), transaction_id = $2, reserved_at = NULL, reservation_id = NULL
          WHERE id = $1`,
        [input.paymentLink.id, txn.id],
      );
    }

    // Double-entry journaling. One entry_group_id per capture event; the
    // fee leg pair is omitted entirely when feeFils = 0 (ledger_entries has
    // a CHECK (amount_fils > 0), and a zero-value entry carries no
    // accounting information anyway).
    const entryGroupId = randomUUID();
    await client.query(
      `INSERT INTO ledger_entries
         (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
       VALUES
         ($1, $2, $3, 'card_scheme_clearing', 'debit',  $4, now(), 'capture: gross'),
         ($1, $2, $3, 'merchant_payable',     'credit', $4, now(), 'capture: gross')`,
      [entryGroupId, input.merchantId, txn.id, requestedAmount],
    );
    if (feeFils > 0) {
      await client.query(
        `INSERT INTO ledger_entries
           (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
         VALUES
           ($1, $2, $3, 'merchant_payable',     'debit',  $4, now(), 'capture: MDR fee'),
           ($1, $2, $3, 'platform_fee_revenue', 'credit', $4, now(), 'capture: MDR fee')`,
        [entryGroupId, input.merchantId, txn.id, feeFils],
      );
    }

    // Hold lifecycle: released exactly when nothing remains outstanding.
    if (fullyCaptured) {
      await client.query(`UPDATE holds SET status = 'released' WHERE transaction_id = $1 AND status = 'active'`, [
        txn.id,
      ]);
    }

    await enqueueEvent(client, {
      eventType: "transaction.captured",
      aggregateType: "transaction",
      aggregateId: txn.id,
      payload: {
        merchantId: input.merchantId,
        amountCapturedFils: requestedAmount,
        feeFils,
        newStatus,
        capturedTotalFils: newCapturedFils,
      },
    });

    await recordTransactionEvent(client, {
      transactionId: txn.id,
      eventType: fullyCaptured ? "captured" : "partially_captured",
      amountFils: requestedAmount,
      actor: input.actor,
      // discountBps marks feeFils as already net of the negotiated discount,
      // so applyCaptureDiscountAdjustment must not rebate it again.
      metadata: { feeFils, discountBps, acquirerReference: acquirerResult.acquirerReference },
    });

    const body = serializeTransaction(updatedTxn);
    await completeIdempotencyKey(client, claim.row.id, { statusCode: 200, body, resourceId: txn.id });
    return { statusCode: 200, body };
  });
}
