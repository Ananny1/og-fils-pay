# BUG-108 — Payment-link list: "active" filter returns expired links

**Summary:** Filtering the merchant's payment links by `active` also returned links whose expiry had
passed (which the dashboard shows as "expired" and checkout refuses with 410), and `?status=expired`
returned nothing. The filter now matches the status the merchant actually sees.

## Issue
A merchant filters their links by "active" and gets dead links mixed in. Asking for `expired` gives
an empty list, even though the table shows expired links.

## Why (root cause)
`apps/api/src/paymentLinks/query.ts` filtered on the stored column:
`AND ($2::text[] IS NULL OR status = ANY($2))`. `expired` is never stored (migration 0020: a link
stays `active` past `expires_at`, every reader compares to `now()`), so the stored-status filter can
never tell a live link from an expired one.

**Present in the original code:** `apps/api/src/paymentLinks/query.ts:73` at 8b58b0f (same line).

## Who was affected
Every merchant using the payment-link list filter (dashboard or API). Not a money loss, but a wrong
list of "links customers can still pay".

## Fix
Before: `status = ANY($2)`
After: `(CASE WHEN status = 'active' AND expires_at <= now() THEN 'expired' ELSE status END) = ANY($2)`
— the same rule as the dashboard's `linkDisplayStatus` (BUG-101). Only the WHERE changes; ordering,
keyset cursor and the `(merchant_id, created_at)` index use are untouched. `reserved`, `paid`,
`canceled` behave as before.

## Options ranked
1. **Derive the status in the WHERE (chosen)** — one line, no migration, matches the dashboard.
2. Store `expired` with a sweep job — needs a migration, a CHECK change, a cron, and is stale between sweeps.
3. Filter in the dashboard only — breaks pagination (pages come back short) and API users still get it wrong.

## Proof
Test: `apps/api/src/routes/paymentLinksStatusFilter.new.test.ts` (one live link, one past expiry).

Before the fix:
```
✖ BUG-108: ?status=active leaves out a link whose expiry has passed
✖ BUG-108: ?status=expired returns exactly the past-expiry links
✔ BUG-108: no status filter still lists every link
ℹ pass 1
ℹ fail 2
```
After the fix (with `paymentLinksList.new.test.ts` and `paymentLinks.test.ts`):
```
✔ BUG-108: ?status=active leaves out a link whose expiry has passed
✔ BUG-108: ?status=expired returns exactly the past-expiry links
✔ BUG-108: no status filter still lists every link
ℹ pass 18
ℹ fail 0
```
