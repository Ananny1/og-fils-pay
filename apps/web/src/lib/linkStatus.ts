/**
 * The status a merchant should see for a payment link. Links are never
 * stored as `expired`: the API derives that only for the public checkout
 * (`apps/api/src/paymentLinks/status.ts`) and refuses payment with 410. So
 * an `active` link whose expiry has passed is shown as `expired` here, the
 * same thing the customer sees (BUG-101).
 */
export function linkDisplayStatus(link: { status: string; expiresAt: string }, now: Date = new Date()): string {
  if (link.status === "active" && new Date(link.expiresAt).getTime() <= now.getTime()) return "expired";
  return link.status;
}
