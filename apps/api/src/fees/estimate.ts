import { applyRateFils, subtractFils, toFils } from "@filspay/money";

/**
 * Estimated settlement fee for a single capture event, integer fils only:
 * the same formula as apps/settlement ComputeSettlementFee
 * (discounted_fee.go) — discount applied to the amount, then the MDR, both
 * via banker's-rounded applyRateFils. It used float rates and Math.round
 * (ADR-0001 forbids floats on money paths), so it could be 1 fil off the
 * batch for the same event.
 */
export function estimateFeeFils(
  amountFils: number,
  mdrBps: number,
  discountBps: number,
): number {
  const amount = toFils(amountFils);
  const discountedAmount = subtractFils(amount, applyRateFils(amount, discountBps));
  return Number(applyRateFils(discountedAmount, mdrBps));
}
