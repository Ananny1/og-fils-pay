import type { Pool } from "pg";
import { toFils, type Fils } from "@filspay/money";
import { authorizeTransaction } from "../payments/authorize.js";
import { captureTransaction } from "../payments/capture.js";
import { voidTransaction } from "../payments/void.js";
import type { AcquirerSimulator, SimulatedCardInput } from "../acquirer/types.js";

export interface PayPaymentLinkInput {
  token: string;
  card: SimulatedCardInput;
  idempotencyKey: string;
}

export interface PayPaymentLinkResult {
  statusCode: number;
  body: unknown;
}

/** Returned by the claim UPDATE; merchant_id comes from the link row, never from the request. */
interface ClaimedLinkRow {
  id: string;
  merchant_id: string;
  amount_fils: string | number;
  reference: string | null;
  reservation_id: string;
}

interface LinkStatusRow {
  status: string;
  expires_at: Date;
}

/** Expiry is always judged by the server's own clock. A client-supplied
 * time (the old `submittedAt`) is ignored: this route is public, so any
 * value the caller sends is under the payer's control (BUG-004). */
export function expiryReferenceTime(_clientTime?: string): Date {
  return new Date();
}

/**
 * `POST /v1/payment-links/:token/pay` business logic (public,
 * unauthenticated). Calls `authorizeTransaction`
 * then `captureTransaction` directly, in sequence, never issuing an HTTP
 * request back into the API's own /v1/transactions routes.
 *
 * Concurrency: reserve the link with a single
 * atomic conditional UPDATE, release the row lock immediately, run
 * authorize+capture with no lock held on payment_links at all, then
 * finalize with a second atomic conditional UPDATE keyed on still being in
 * the 'reserved' state. A short, configurable reservation timeout
 * self-heals a link stuck 'reserved' by a crash between claim and
 * finalize, with no sweep job.
 *
 * BUG-005 (incident 2026-05-14): the timeout also lets a second payer
 * re-claim a link whose first payer is merely slow. Every claim therefore
 * writes a fresh reservation_id; capture checks it under a link row lock
 * held through the acquirer call and marks the link paid in the same
 * database transaction, and a unique index (migration 0075) allows at most
 * one captured transaction per link. A payer who lost the link gets a 409
 * and their authorization is voided.
 */
export async function payPaymentLink(
  pool: Pool,
  acquirer: AcquirerSimulator,
  config: { paymentLinkReservationTimeoutSeconds: number },
  input: PayPaymentLinkInput,
): Promise<PayPaymentLinkResult> {
  const expiryCheckTime = expiryReferenceTime();

  // Step 1 — claim. A single UPDATE is already atomic; no explicit
  // transaction needed.
  // YA: one conditional UPDATE = atomic claim, no explicit txn needed. correct
  const claimResult = await pool.query<ClaimedLinkRow>(
    `UPDATE payment_links
        SET status = 'reserved', reserved_at = now(), reservation_id = gen_random_uuid()
      WHERE token = $1
        AND (
             status = 'active'
             OR (status = 'reserved' AND reserved_at < now() - ($2 || ' seconds')::interval)
            )
        AND expires_at > $3
      RETURNING id, merchant_id, amount_fils, reference, reservation_id`,
    [input.token, config.paymentLinkReservationTimeoutSeconds, expiryCheckTime],
  );

  const claimedRow = claimResult.rows[0];
  if (!claimedRow) {
    return classifyClaimFailure(pool, input.token, config.paymentLinkReservationTimeoutSeconds, expiryCheckTime);
  }

  const link = {
    id: claimedRow.id,
    merchantId: claimedRow.merchant_id,
    amountFils: toFils(Number(claimedRow.amount_fils)),
    reference: claimedRow.reference,
    reservationId: claimedRow.reservation_id,
  };

  try {
    return await authorizeCaptureAndFinalize(pool, acquirer, config, input, link, expiryCheckTime);
  } catch (err) {
    // An exception (idempotency conflict, DB error) must not leave the link
    // stuck 'reserved' until the timeout; release our own reservation only.
    await releaseReservation(pool, link.id, link.reservationId);
    throw err;
  }
}

async function authorizeCaptureAndFinalize(
  pool: Pool,
  acquirer: AcquirerSimulator,
  config: { paymentLinkReservationTimeoutSeconds: number },
  input: PayPaymentLinkInput,
  link: { id: string; merchantId: string; amountFils: Fils; reference: string | null; reservationId: string },
  expiryCheckTime: Date,
): Promise<PayPaymentLinkResult> {
  // Step 2 — authorize.
  // am: keys include link.id so two links can never collide on idempotency. good
  const authorizeKey = `paylink:${link.id}:${input.idempotencyKey}:authorize`;
  const authResult = await authorizeTransaction(pool, acquirer, {
    merchantId: link.merchantId,
    amountFils: link.amountFils,
    card: input.card,
    reference: link.reference ?? undefined,
    idempotencyKey: authorizeKey,
    // No merchant session/API key initiated this — a customer did, via
    // the public link.
    actor: { type: "system" },
    paymentLinkId: link.id,
  });

  if (authResult.statusCode !== 201) {
    await releaseReservation(pool, link.id, link.reservationId);
    return {
      statusCode: authResult.statusCode,
      body: { stage: "authorize", ...(authResult.body as Record<string, unknown>) },
    };
  }

  const txnId = (authResult.body as { id: string }).id;

  // The merchant's negotiated discount is part of capture.ts's own fee
  // calculation (BUG-036), so this path charges the same fee as settlement.
  // Step 3 — capture (full amount, immediately). amountFils omitted =>
  // capture the full remaining amount — always correct here, since this
  // transaction was just authorized for exactly link.amountFils and
  // nothing else could have touched it yet.
  const captureKey = `paylink:${link.id}:${input.idempotencyKey}:capture`;
  const captureResult = await captureTransaction(pool, acquirer, {
    transactionId: txnId,
    merchantId: link.merchantId,
    idempotencyKey: captureKey,
    actor: { type: "system", id: link.id },
    paymentLink: { id: link.id, reservationId: link.reservationId },
  });

  if (captureResult.statusCode !== 200) {
    const captureBody = captureResult.body as Record<string, unknown>;
    if (captureBody.error === "payment_link_reservation_lost") {
      // BUG-005: our reservation timed out and another payer took the link
      // (or it was canceled) before we captured. No money moved for us;
      // drop this payer's authorization hold and tell them the link's state.
      await voidTransaction(pool, {
        transactionId: txnId,
        merchantId: link.merchantId,
        actor: { type: "system", id: link.id },
      });
      const current = await classifyClaimFailure(
        pool,
        input.token,
        config.paymentLinkReservationTimeoutSeconds,
        expiryCheckTime,
      );
      return { statusCode: current.statusCode, body: { stage: "capture", ...(current.body as Record<string, unknown>) } };
    }
    await releaseReservation(pool, link.id, link.reservationId);
    return {
      statusCode: captureResult.statusCode,
      body: { stage: "capture", ...captureBody },
    };
  }

  // Step 4 — finalize. A fresh capture already marked the link paid in its
  // own database transaction (BUG-005), so normally this is just a read.
  // A replayed capture (retry after a crash between capture and finalize in
  // older code) finalizes here, still fenced on our own reservation.
  const finalizeResult = await pool.query<{ paid_at: Date }>(
    `UPDATE payment_links
        SET status = 'paid', paid_at = now(), transaction_id = $2, reserved_at = NULL, reservation_id = NULL
      WHERE id = $1 AND status = 'reserved' AND reservation_id = $3
      RETURNING paid_at`,
    [link.id, txnId, link.reservationId],
  );
  const finalized =
    finalizeResult.rows[0] ??
    (
      await pool.query<{ paid_at: Date }>(
        `SELECT paid_at FROM payment_links WHERE id = $1 AND status = 'paid' AND transaction_id = $2`,
        [link.id, txnId],
      )
    ).rows[0];

  if (!finalized) {
    // The capture succeeded but the link is held by someone else. With the
    // fenced capture above this cannot happen for a fresh capture; never
    // answer 200 here, so the payer is not told a link was paid by them
    // when the link says otherwise.
    console.error(
      `payPaymentLink: link ${link.id} not finalized for captured transaction ${txnId} — invariant violation, investigate`,
    );
    return { statusCode: 409, body: { stage: "finalize", error: "payment_link_reservation_lost", transactionId: txnId } };
  }

  return {
    statusCode: 200,
    body: {
      status: "paid",
      transactionId: txnId,
      amountFils: link.amountFils,
      paidAt: finalized.paid_at.toISOString(),
    },
  };
}

/**
 * Used by the decline/error branches above. Fenced on reservation_id: this
 * request only ever releases the reservation it itself holds, never one a
 * second payer took over after ours timed out (BUG-005).
 */
async function releaseReservation(pool: Pool, linkId: string, reservationId: string): Promise<void> {
  await pool.query(
    `UPDATE payment_links SET status = 'active', reserved_at = NULL, reservation_id = NULL
      WHERE id = $1 AND status = 'reserved' AND reservation_id = $2`,
    [linkId, reservationId],
  );
}

/**
 * The claim UPDATE matched 0 rows. This second read carries no race risk —
 * nothing further is decided from it, it only explains a decision already
 * made by the failed UPDATE.
 */
// FH: "This second read carries no race risk" — Claude disagrees, says we should SELECT
// ... FOR UPDATE here. TODO
// am: its only for the error message. ignore
async function classifyClaimFailure(
  pool: Pool,
  token: string,
  reservationTimeoutSeconds: number,
  expiryCheckTime: Date,
): Promise<PayPaymentLinkResult> {
  const result = await pool.query<LinkStatusRow>(`SELECT status, expires_at FROM payment_links WHERE token = $1`, [
    token,
  ]);
  const row = result.rows[0];

  if (!row) {
    return { statusCode: 404, body: { error: "payment_link_not_found" } };
  }
  if (row.status === "paid") {
    return { statusCode: 409, body: { error: "payment_link_already_paid" } };
  }
  if (row.status === "canceled") {
    return { statusCode: 409, body: { error: "payment_link_canceled" } };
  }
  if (row.status === "active" && row.expires_at.getTime() <= expiryCheckTime.getTime()) {
    return { statusCode: 410, body: { error: "payment_link_expired" } };
  }
  if (row.status === "reserved") {
    // A concurrent claim attempt raced us and won between our own UPDATE's
    // failure and this SELECT. It's still within the timeout (if it
    // weren't, our claim UPDATE would have matched it) — reachable only in
    // a genuine race, not a stale read.
    return { statusCode: 409, body: { error: "payment_link_processing" } };
  }
  // Defensive fallback, should be unreachable given the claim UPDATE's
  // WHERE clause exactly mirrors these cases.
  return { statusCode: 409, body: { error: "payment_link_not_payable", status: row.status } };
}
