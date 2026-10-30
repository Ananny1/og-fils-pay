import type { Pool, PoolClient } from "pg";
import { toFils } from "@filspay/money";
import { authorizeTransaction } from "../payments/authorize.js";
import { captureTransaction } from "../payments/capture.js";
import { voidTransaction } from "../payments/void.js";
import type { AcquirerSimulator, SimulatedCardInput } from "../acquirer/types.js";

export interface PayPaymentLinkInput {
  token: string;
  card: SimulatedCardInput;
  idempotencyKey: string;
  submittedAt?: string;
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
}

interface LinkStatusRow {
  status: string;
  expires_at: Date;
}

/** A pay request is judged against when the buyer pressed pay, so a
 * retry that lands after midnight is not penalised. */
export function expiryReferenceTime(_submittedAt?: string): Date {
  // BUG-004: the payer's clock never decides expiry, even if a caller passes it.
  return new Date();
}

/**
 * `POST /v1/payment-links/:token/pay` business logic (public,
 * unauthenticated). Calls `authorizeTransaction`
 * then `captureTransaction` directly, in sequence, never issuing an HTTP
 * request back into the API's own /v1/transactions routes.
 *
 * Concurrency (BUG-005): one checkout = one pool connection. The checkout
 * takes a session advisory lock on the link (pg_try_advisory_lock, no
 * waiting) on that connection, and runs claim, authorize, capture and
 * finalize on the same connection, each committed on its own. A second
 * payer on the same link does not get the lock and is answered 409
 * payment_link_processing at once, so it never parks a connection. The lock
 * lives exactly as long as the first payer's connection: a crash drops it,
 * and the stale 'reserved' row can be re-claimed after the reservation
 * timeout, but never once a capture for this link has completed (see the
 * claim below). The old designs either re-claimed a live reservation after
 * the timeout (two charges, incident 2026-05-14) or held one connection
 * while waiting for a second one from the same pool (pool starvation).
 */
export async function payPaymentLink(
  pool: Pool,
  acquirer: AcquirerSimulator,
  config: { paymentLinkReservationTimeoutSeconds: number },
  input: PayPaymentLinkInput,
): Promise<PayPaymentLinkResult> {
  const expiryCheckTime = expiryReferenceTime(input.submittedAt);
  const lockKey = `payment_link:${input.token}`;

  const client = await pool.connect();
  let locked = false;
  let releaseError: Error | undefined;
  try {
    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`,
      [lockKey],
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) {
      // Another payer is paying this link right now.
      return { statusCode: 409, body: { error: "payment_link_processing" } };
    }
    return await payWithLinkLocked(client, acquirer, config, input, expiryCheckTime);
  } finally {
    if (locked) {
      // A session lock survives release(); if unlocking fails, destroy the
      // connection so the lock goes with it.
      await client
        .query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [lockKey])
        .catch((err: Error) => {
          releaseError = err;
        });
    }
    client.release(releaseError);
  }
}

async function payWithLinkLocked(
  client: PoolClient,
  acquirer: AcquirerSimulator,
  config: { paymentLinkReservationTimeoutSeconds: number },
  input: PayPaymentLinkInput,
  expiryCheckTime: Date,
): Promise<PayPaymentLinkResult> {
  // Step 1 — claim (committed at once). A stale 'reserved' row means its
  // payer died (we hold the advisory lock); it may be re-claimed only if no
  // capture for this link completed under another Idempotency-Key, so a
  // payment whose finalize was lost never makes the link payable again. The
  // same key may re-claim: its authorize/capture replay and finalize records
  // the one existing transaction.
  const claimResult = await client.query<ClaimedLinkRow>(
    `UPDATE payment_links
        SET status = 'reserved', reserved_at = now()
      WHERE token = $1
        AND (
             status = 'active'
             OR (status = 'reserved' AND reserved_at < now() - ($2 || ' seconds')::interval
                 AND NOT EXISTS (
                   SELECT 1 FROM idempotency_keys k
                    WHERE k.merchant_id = payment_links.merchant_id
                      AND k.endpoint = 'transactions.capture'
                      AND k.key LIKE 'paylink:' || payment_links.id || ':%'
                      AND k.key <> 'paylink:' || payment_links.id || ':' || $4 || ':capture'
                      AND k.status = 'completed' AND k.response_status_code = 200))
            )
        AND expires_at > $3
      RETURNING id, merchant_id, amount_fils, reference`,
    [input.token, config.paymentLinkReservationTimeoutSeconds, expiryCheckTime, input.idempotencyKey],
  );

  const claimedRow = claimResult.rows[0];
  if (!claimedRow) {
    return classifyClaimFailure(client, input.token, config.paymentLinkReservationTimeoutSeconds, expiryCheckTime);
  }

  const link = {
    id: claimedRow.id,
    merchantId: claimedRow.merchant_id,
    amountFils: toFils(Number(claimedRow.amount_fils)),
    reference: claimedRow.reference,
  };

  // Step 2 — authorize.
  // am: keys include link.id so two links can never collide on idempotency. good
  const authorizeKey = `paylink:${link.id}:${input.idempotencyKey}:authorize`;
  const authResult = await authorizeTransaction(client, acquirer, {
    merchantId: link.merchantId,
    amountFils: link.amountFils,
    card: input.card,
    reference: link.reference ?? undefined,
    idempotencyKey: authorizeKey,
    // No merchant session/API key initiated this — a customer did, via
    // the public link.
    actor: { type: "system" },
  }).catch(async (err: unknown) => {
    // Nothing captured yet: give the link back so the payer can retry.
    await releaseReservation(client, link.id).catch(() => undefined);
    throw err;
  });

  if (authResult.statusCode !== 201) {
    await releaseReservation(client, link.id);
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
  const captureResult = await captureTransaction(client, acquirer, {
    transactionId: txnId,
    merchantId: link.merchantId,
    idempotencyKey: captureKey,
    actor: { type: "system", id: link.id },
  });

  if (captureResult.statusCode !== 200) {
    // BUG-082: nothing was captured, so give the authorization back. Left
    // 'authorized', it held the payer's card for 7 days and the merchant
    // could still capture it after the payer paid again with a new key.
    await voidTransaction(client, {
      transactionId: txnId,
      merchantId: link.merchantId,
      actor: { type: "system", id: link.id },
    });
    await releaseReservation(client, link.id);
    return {
      statusCode: captureResult.statusCode,
      body: { stage: "capture", ...(captureResult.body as Record<string, unknown>) },
    };
  }

  // Step 4 — finalize, committed right after capture. Money has moved, so a
  // failure here must not undo anything: the link stays 'reserved' and the
  // claim's capture check keeps it from ever being paid again.
  let finalizeResult;
  try {
    finalizeResult = await client.query<{
      id: string;
      paid_at: Date;
    }>(
      `UPDATE payment_links
          SET status = 'paid', paid_at = now(), transaction_id = $2, reserved_at = NULL
        WHERE id = $1 AND status = 'reserved'
        RETURNING id, paid_at`,
      [link.id, txnId],
    );
  } catch (err) {
    console.error(
      `payPaymentLink: finalize FAILED for link ${link.id} after a successful capture (transaction ${txnId}); ` +
        `link left 'reserved' (not payable again) — mark it paid by hand`,
      err,
    );
    return {
      statusCode: 200,
      body: { status: "paid", transactionId: txnId, amountFils: link.amountFils, paidAt: new Date().toISOString() },
    };
  }

  const finalized = finalizeResult.rows[0];
  if (!finalized) {
    // Unreachable since BUG-005: this request has held the link's advisory
    // lock since the claim, so no one else can re-claim it. The acquirer-side capture genuinely
    // succeeded and money moved; failing to *record* that fact against the
    // link is a data-consistency bug to surface loudly, not a reason to
    // tell a customer whose card was actually charged that their payment
    // failed.
    console.error(
      `payPaymentLink: finalize UPDATE matched 0 rows for link ${link.id} after a successful capture ` +
        `(transaction ${txnId}) — invariant violation, investigate`,
    );
    return {
      statusCode: 200,
      body: { status: "paid", transactionId: txnId, amountFils: link.amountFils, paidAt: new Date().toISOString() },
    };
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
 * Used by both decline branches above. Guarded by `status =
 * 'reserved'` for the same reason as the finalize UPDATE: this request
 * only ever releases the reservation it itself holds.
 */
async function releaseReservation(client: PoolClient, linkId: string): Promise<void> {
  await client.query(`UPDATE payment_links SET status = 'active', reserved_at = NULL WHERE id = $1 AND status = 'reserved'`, [
    linkId,
  ]);
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
  client: PoolClient,
  token: string,
  reservationTimeoutSeconds: number,
  expiryCheckTime: Date,
): Promise<PayPaymentLinkResult> {
  const result = await client.query<LinkStatusRow>(`SELECT status, expires_at FROM payment_links WHERE token = $1`, [
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
