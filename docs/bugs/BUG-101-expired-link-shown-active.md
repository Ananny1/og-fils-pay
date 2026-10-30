# BUG-101 — Merchant dashboard shows an expired payment link as "active"

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Payment links (merchant dashboard) |
| **Commit** | see `git log --grep BUG-101` |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

## Summary

- **What's wrong:** after its expiry time, a link still shows a green "active" badge in the dashboard list and detail page, with "Share this URL with the customer".
- **Why:** the pages render the stored `status`, and the database never stores `expired`; the API derives "expired" only for the public checkout.
- **What it breaks:** the merchant keeps sending a link the customer cannot pay (checkout says expired, pay returns 410), and loses or delays the sale.

## Root cause

Present in the original code: `apps/web/src/pages/payment-links/PaymentLinkDetailPage.tsx:123` and
`apps/web/src/pages/payment-links/PaymentLinkListPage.tsx:114` at 8b58b0f (`{link.status}` rendered as is).

`PaymentLinkStatus` is `active | reserved | paid | canceled` (`apps/web/src/types.ts:130`);
nothing writes `'expired'` to `payment_links`. Expiry is derived in
`apps/api/src/paymentLinks/status.ts` for the public read only. The merchant list query
(`apps/api/src/paymentLinks/query.ts`) returns the raw stored status.

## Fix

`apps/web/src/lib/linkStatus.ts` `linkDisplayStatus(link, now)`: `active` with `expiresAt <= now`
→ `expired`; everything else unchanged. Used for the badge on the list and detail pages; the
detail page's share hint says the link expired instead of "Share this URL".

## Options

| Rank | Option | Chosen? |
|---|---|---|
| 1 | Derive "expired" in the dashboard, same rule as the public checkout | ✅ |
| 2 | Serialize a derived status in the merchant API | API change; status filter semantics change |
| 3 | Background job writing `expired` | migration + new job |

## Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| active link past expiry shows expired | `apps/web/src/lib/linkStatus.test.ts` | ❌ got `active` | ✅ `expired` |
| active before expiry / paid / canceled unchanged | same | ✅ | ✅ |

`npm test -w apps/web` → 42 pass, 0 fail; `npm run build -w apps/web` OK.
