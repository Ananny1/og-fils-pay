import { ZERO_FILS, compareFils, type Fils } from "@filspay/money";

/**
 * The `transactions.status` a row should carry once a refund has been
 * applied to it.
 *
 * Status on this platform is derived from the money columns rather than
 * transitioned by hand: `capture.ts` computes it from `captured_fils` against
 * `amount_fils` at the end of every capture, and this is the same idea for
 * the refund side. Deriving it keeps the status and the amounts from ever
 * disagreeing, and keeps the rule in one readable, testable place instead of
 * spread across the endpoints that happen to write the column.
 */

/**
 * "refunded" means refunded_fils === captured_fils; "partially_refunded"
 * means 0 < refunded_fils < captured_fils. A transaction is never left in a
 * capture status once its full captured amount has been returned.
 */
export type PostRefundStatus = "captured" | "partially_captured" | "partially_refunded" | "refunded";

export interface PostRefundStatusInput {
  /** The authorized amount. */
  amountFils: Fils;
  capturedFils: Fils;
  /** The refunded total *after* the refund being applied, not the delta. */
  refundedTotalFils: Fils;
}

// Huda's rule from the finance call (Sep): "a transaction is refunded when every fils we captured
// went back" -- including a partial capture (BUG-057).
export function nextStatusAfterRefund(input: PostRefundStatusInput): PostRefundStatus {
  // Everything captured has gone back: the sale is over, whatever headroom
  // the authorization still had (BUG-057). Leaving it partially_captured
  // showed a fully refunded sale as an open one, and let it be captured again.
  if (
    compareFils(input.refundedTotalFils, ZERO_FILS) > 0 &&
    compareFils(input.refundedTotalFils, input.capturedFils) >= 0
  ) {
    return "refunded";
  }

  // A partial refund does not end a partial capture: the authorization
  // still has headroom the merchant may capture, and every capture path
  // gates on the capture statuses, so the row keeps partially_captured and
  // records the return in `refunded_fils`.
  if (compareFils(input.capturedFils, input.amountFils) < 0) {
    return "partially_captured";
  }

  if (compareFils(input.refundedTotalFils, ZERO_FILS) === 0) {
    return "captured";
  }
  if (compareFils(input.refundedTotalFils, input.capturedFils) < 0) {
    return "partially_refunded";
  }
  return "refunded";
}
