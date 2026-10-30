# BUG-097 — An expired link left "reserved" shows as payable

| | |
|---|---|
| **Severity** | Low |
| **Area** | Public checkout |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/paymentLinks/status.ts:40` and `apps/api/src/paymentLinks/pay.ts:222` at 8b58b0f.

## Summary

- **What's wrong:** A link whose payer went away mid-checkout (row stays `reserved`) and that has since expired is shown to the next buyer as `active` with a Pay button; pressing Pay answers `409 payment_link_processing` ("someone is paying") forever.
- **Why:** both status helpers check expiry only for `status = 'active'`.
- **What it breaks:** buyers see a live link that can never be paid and a misleading "in progress" error; the merchant's customer is never told the link expired.

## Root cause

`status.ts:40` (before): `return stillReserved ? "processing" : "active";` — a stale reservation is reported `active` without looking at `expiresAt`.
`pay.ts` `classifyClaimFailure` (before): `if (row.status === "active" && row.expires_at <= now) → 410`; a `reserved` row falls through to `409 payment_link_processing`.

## Fix

- `status.ts`: a stale reservation is `expired` once `expiresAt` has passed, else `active`.
- `pay.ts`: `reserved` rows past expiry also answer `410 payment_link_expired`.

## Options

| Rank | Option | Chosen? |
|---|---|---|
| 1 | Check expiry for stale reserved rows in both helpers | ✅ |
| 2 | Sweep job that resets stale reservations to active | Still needs the expiry rule; more moving parts |

## Proof

`apps/api/src/paymentLinks/staleReservedExpired.new.test.ts`

| Test | Before fix | After fix |
|---|---|---|
| derivePublicStatus stale reserved past expiry | ❌ `'active'` | ✅ `'expired'` |
| read + pay of a stale reserved, expired link | ❌ read `'active'` (pay 409 processing) | ✅ read `'expired'`, pay `410 payment_link_expired` |

Existing payment-link suites (status, pay, concurrency, routes): 28/28 pass.
