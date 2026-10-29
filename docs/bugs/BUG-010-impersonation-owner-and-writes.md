# BUG-010 — "View as merchant" gives staff owner powers, and the view can write

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Security (authorization) |
| **Analysis ID** | A7, A8 |
| **Clue** | HANDOVER: "Impersonation maps every admin to the `support` merchant role and is read-only"; S4 "admin actions without the right role checks" |
| **Evidence** | S4 |
| **Decision** | D-003 |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** When FilsPay staff "view as" a shop, a super_admin gets the shop **owner's** powers and a finance admin gets **finance** powers, and every admin, even support, can capture, void and save filters for the shop.
- **Why:** The role map gives `super_admin → owner` and `finance → finance` instead of `support` for all, and nothing makes the impersonation read-only: capture, void and saved filters have no role gate at all.
- **What it breaks:** Staff can create payment links, change webhooks, capture or void a shop's payments, and the change is recorded as **the shop's own action** (`merchant_session`), so the shop's history can't show it was staff.

## 1. The issue

Live, before the fix: seeded `superadmin@filspay.test` logs in, clicks "view as" Delta Wholesale, then:

```
GET  /v1/transactions                              200   (expected: viewing is allowed)
POST /v1/merchants/<Delta>/payment-links  5 BD     201   a live payment link in Delta's shop
POST /v1/reporting/saved-filters                   201
payment_links.created_by_type                      'merchant_session'   (looks like Delta did it)
```

In the tests, a **support** admin's view also got past the auth check on capture and void (404 "not
found" instead of 403): only the missing transaction stopped it.

## 2. Why it happened

- `apps/api/src/admin/impersonation.ts` `MERCHANT_ROLE_FOR_ADMIN_ROLE`:
  `support → support`, `finance → finance`, `super_admin → owner`. The interface just below it
  says "Always 'support' (ARCH §8): a grant is view-only", and HANDOVER says the same. The code didn't match.
- `apps/api/src/auth/requireMerchantAuth.ts` let the grant through like a normal merchant session and
  relied only on `requireMerchantRole` gates. But `/transactions/:id/capture`, `/:id/void` and
  `/reporting/saved-filters` have **no** role gate, so even `support` reached them.
- `requireMerchantWriterActor` records any cookie write as `merchant_session`.
- Comments that hid it: MK in `transactions.ts` "impersonation is read-only, enforced in
  requireMerchantAuth" (it wasn't); YA "impersonation can't reach write routes"; the existing test
  "covers support only. finance/super_admin impersonation not tested — MK" (T-52).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Staff can move money (capture/void), create payment links, change webhook URLs (where money notices go) in their shop | Critical |
| Merchants' customers | A staff-created payment link or changed webhook looks like the shop's own | High |
| FilsPay | Insider risk with no trace: writes are recorded as the merchant (CBB audit, disputes) | High |
| FilsPay staff | A support agent "just looking" can void a payment by mistake | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/admin/impersonation.ts` | Every admin role maps to `support` (matches HANDOVER and the interface's own doc). |
| `apps/api/src/auth/requireMerchantAuth.ts` | An impersonation grant is refused (403 `forbidden`) on any method other than GET/HEAD, in one place, for every route. |
| `apps/api/src/routes/impersonation.readOnly.test.ts` | New tests (below). |

A real merchant session or API key is never affected: they are checked before the grant.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Map every admin to `support` **and** refuse non-GET for grants in `requireMerchantAuth` | Matches HANDOVER exactly; one check covers every current and future write route; 2 small changes | A future "support may do X while viewing" feature needs an explicit exception | ✅ |
| 2 | Only fix the role map | Smallest diff | Capture / void / saved filters stay open to every admin | |
| 3 | Throw in `requireMerchantWriterActor` for `admin_impersonation` (ANALYSIS A8) | Close to the attribution code | Only covers routes that call it: saved filters doesn't, and the check runs after the body is parsed | |
| 4 | Add role gates to capture / void / saved filters | Also needed for real `support` users | That's a separate question (who in a shop may void: BUG-033 audit); doesn't make impersonation read-only | |
| 5 | Outside the box: record impersonated actions with their own actor type and show "done by FilsPay staff" to the merchant | Full transparency if writes are ever allowed | Migration on 3 CHECK constraints; not needed while the view is read-only (idea for F4) | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| a support / finance / super_admin grant resolves to the read-only support role (3 tests) | `apps/api/src/routes/impersonation.readOnly.test.ts` | ❌ finance, owner | ✅ |
| a support / finance / super_admin grant cannot write, even on routes without a role gate: payment link, capture, void, saved filter (3 tests) | same | ❌ 201 / 404 | ✅ 403, nothing written |

API suite: 389 tests, 377 pass, 12 fail = the T1 baseline (refund + webhook). `tsc` clean. No existing
test changed (the existing support test still sees `forbidden`).

Real run (API rebuilt), seeded super-admin viewing Delta Wholesale:

| | Before | After |
|---|---|---|
| `GET /v1/transactions` | 200 | 200 |
| Create a 5 BD payment link | **201** (recorded as `merchant_session`) | **403** |
| Save a report filter | **201** | **403** |

The demo link and filter created during the "before" run were deleted from the local DB.

Follow-up: F4 (admin console shows a "view only" banner and hides write buttons while viewing).
