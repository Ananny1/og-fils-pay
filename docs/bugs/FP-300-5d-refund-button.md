# FP-300.5 (dashboard) — the Refund button on the transaction page

| | |
|---|---|
| **Severity** | Feature (missing) · ★★ |
| **Area** | Refunds (FP-300) · Merchant dashboard (`apps/web`) |
| **Analysis ID** | §4 checklist item 7 ("`RefundDrawer` wiring in `apps/web`") |
| **Clue** | `RefundDrawer.tsx` "Parked, not wired … POST /v1/refunds still answers 501"; `TransactionDetailPage.tsx` "RefundDrawer import removed 2026-06 until the route exists"; `router.tsx` "/refunds route removed until FP-212" |
| **Owner** | Ebrahim (frontend) |
| **Status** | ✅ done |

## Summary (the short note)

- **What was missing:** merchants had no way to refund from the dashboard. The drawer was written but
  commented out, and the page never showed it.
- **Why:** it was parked until the API route existed. The route exists since FP-300.1
  (`POST /v1/merchants/:merchantId/refunds`), so the comments saying otherwise were now false.
- **Problems in the parked drawer, fixed while wiring it:**
  1. Amount was typed in **fils** (`type="number"`), while every other amount in the product is BD with 3
     decimals. Now typed in BD and turned into fils with `parseBhdToFils` (string maths, no float).
  2. It was hidden for `partially_refunded` (so a second partial refund was impossible) and its `max` was
     `capturedFils`, ignoring what was already refunded. Now it shows for captured / partially captured /
     partially refunded while `capturedFils − refundedFils > 0`, and shows that amount.
  3. Errors showed raw codes (or nothing: validation errors come back as `{ code }`, not `{ error }`, so
     `describeError` printed `undefined`). Now each refund error is said in plain words (over-refund with the
     amount left, already in progress, declined, network down, refunds on hold, not refundable).
- **Kept from the parked version:** a fresh `Idempotency-Key` per attempt, owner/finance only (the server
  also enforces this), refetch of the detail + timeline after success.

## 4. The change

| File | Change |
|---|---|
| `apps/web/src/pages/transactions/RefundDrawer.tsx` | un-parked; BD input, refundable = captured − refunded, plain-word errors, stale "parked" notes removed |
| `apps/web/src/pages/transactions/TransactionDetailPage.tsx` | imports and shows `<RefundDrawer txn onRefunded={load} />` beside Capture / Void; two false comments removed |
| `apps/web/src/router.tsx` | false "/refunds route removed until FP-212" comment replaced: refunds are made from the detail page |
| `apps/web/src/types.ts` | `refundedFils` on `TransactionDto` (the API returns it since the FP-300.5 timeline commit); the contradicting comment removed |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Wire the existing drawer, fix its unit/limit/error handling | Small; matches the dashboard's look; no new page | — | ✅ |
| 2 | Uncomment as-is ("30 min job") | Fastest | Fils input, wrong limit, no second partial refund, raw error codes | |
| 3 | Separate `/dashboard/refunds` page | Room for a refund list | New route/page/list API for no extra need now | |

## 6. Proof

| Check | Before | After |
|---|---|---|
| `tsc --noEmit` (apps/web) | ✅ | ✅ |
| `vite build` (apps/web) | ✅ | ✅ |
| `npm test` (apps/web) | 8/8 | 8/8 |
| API behaviour the drawer relies on (route, roles, idempotency, over-refund 422, refundedFils in detail) | `apps/api/src/routes/refunds.test.ts` | ✅ |

Existing tests changed: none. No new web unit test: the web suite has no React rendering setup; the drawer's
server contract is covered by the API tests above.
