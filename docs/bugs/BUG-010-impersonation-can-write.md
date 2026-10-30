# BUG-010 — "View as merchant" gives owner powers and can move money

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Security |
| **Analysis ID** | A7, A8 |
| **Clue** | `0035_admin_impersonation_grants.sql` header vs. the "MK (July)" note under it; HANDOVER "Impersonation maps every admin to the support merchant role and is read-only" |
| **Decision** | — |
| **Commit** | see `git log --grep "BUG-010"` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

Admins can "view as merchant" for 15 minutes to help with a ticket. This is
meant to be read-only. In practice:

- A **super_admin** became the merchant's **owner**, a **finance** admin became
  merchant **finance**. Both could create payment links, add/rotate webhook
  endpoints (redirecting the merchant's payment events to any URL), and so on.
- **Any** admin, even `support`, could **capture** and **void** the merchant's
  card transactions and save report filters, because those routes have no
  role gate at all.
- All of these writes were recorded as `merchant_session` (see
  `requireMerchantWriterActor`), so the merchant's audit trail showed the
  merchant did it.
- A **disabled** admin kept a working grant until it expired.

## 2. Why it happened — the root cause

Three separate faults in `apps/api/src/admin/impersonation.ts` and
`apps/api/src/auth/requireMerchantAuth.ts`:

```ts
// before — admin/impersonation.ts
const MERCHANT_ROLE_FOR_ADMIN_ROLE = {
  support: "support",
  finance: "finance",
  super_admin: "owner",
};
```

1. The role map was changed in July ("so they can fix things for locked-out
   merchants") against the design in 0035 and HANDOVER. The JSDoc on the
   lookup still says "Always support".
2. Even with `support`, "read-only" relied on every write route carrying an
   owner/finance role gate. `POST /v1/transactions/:id/capture`, `/void` and
   `POST /v1/reporting/saved-filters` use only `requireMerchantAuth` — no role
   check — so any grant could call them. The comments "impersonation is
   read-only, enforced in requireMerchantAuth" (`routes/transactions.ts`) and
   "impersonation can't reach write routes" (`requireMerchantAuth.ts`) were
   false: nothing in `requireMerchantAuth` enforced it.
3. `lookupImpersonationGrant` joined `admin_users` but never checked
   `au.status = 'active'`. The comment "revoked_at gets set by the
   admin-disable trigger" is false — no such trigger exists in any migration.

`docs/ADMIN.md` ("super_admin: everything, including making changes while
viewing as a merchant") is a low-trust doc that contradicts HANDOVER and 0035.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Authorised payments captured or voided by staff, not the merchant | High |
| Merchants | Staff could change webhooks, create links, move money, and it looked like the merchant did it | Critical |
| FilsPay (finance / ops) | Insider risk, broken audit trail, disabled staff keep access | High |
| Acquirer / card scheme / partners | Captures not initiated by the merchant | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/admin/impersonation.ts` | every admin role maps to merchant role `support` |
| `apps/api/src/admin/impersonation.ts` `lookupImpersonationGrant` | add `AND au.status = 'active'` |
| `apps/api/src/auth/requireMerchantAuth.ts` (impersonation branch) | a grant is refused with 403 on any method other than GET/HEAD |

```ts
// after — requireMerchantAuth.ts, impersonation branch
if (request.method !== "GET" && request.method !== "HEAD") {
  throw new ForbiddenError("forbidden");
}
```

The method check is the structural guarantee: "view as merchant" can never
write, on any route, today or in a future route that forgets a role gate.
The role map fix keeps GET routes gated to owner/finance (for example the
reconciliation export) closed to impersonation too, as designed.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Map to `support` + refuse non-GET for grants in `requireMerchantAuth` + status check | One place, covers un-gated routes, matches HANDOVER | — | ✅ |
| 2 | Map to `support` only | Smallest | Capture/void/saved-filters still writable | |
| 3 | Throw in `requireMerchantWriterActor` for impersonation | Targets writes that record an actor | Saved filters and future writes don't call it | |
| 4 | Add role gates to capture/void | Also useful | Doesn't make impersonation read-only by construction | |

**Why we chose #1:** it makes "read-only" true by construction and keeps the change to three small edits.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-010: a super_admin impersonation grant can read but cannot write` | `apps/api/src/routes/adminImpersonation.new.test.ts` | ❌ payment link created (201) | ✅ 403 on all writes |
| `BUG-010: a finance impersonation grant ...` | same | ❌ 201 | ✅ 403 |
| `BUG-010: a support impersonation grant ...` | same | ❌ capture reached the handler (404 for a random id, would capture a real one) | ✅ 403 |
| `BUG-010: a disabled admin's impersonation grant stops working` | same | ❌ 200 | ✅ 401 |

```bash
cd apps/api && npx tsx --test src/routes/adminImpersonation.new.test.ts src/routes/admin.test.ts
```

Existing tests changed: none (the existing support-grant test still passes).
