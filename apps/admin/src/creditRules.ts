/**
 * Whether this operator may approve this credit: it must still be pending and
 * raised by someone else. Mirrors the server's two-person rule
 * (`apps/api/src/admin/creditApproval.ts`, compared by admin user id), so the
 * requester is not offered a button the server always refuses (BUG-100).
 * The server stays the real check.
 */
export function canApproveCredit(
  item: { status: string; requestedByAdminUserId: string },
  adminUserId: string | undefined,
): boolean {
  return item.status === "pending_approval" && item.requestedByAdminUserId !== adminUserId;
}
