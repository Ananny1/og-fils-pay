# BUG-033 — Admin route role audit: support staff could issue money credits

| | |
|---|---|
| **Severity** | High |
| **Area** | Security (authorization) · Money |
| **Analysis ID** | A10 (admin role checks), S4 "admin actions without the right role checks" |
| **Clue** | am's note in `adminCredits.test.ts`: "create isn't in this test, only approve/reject. intentional?" |
| **Owner** | Ebrahim (sprint stream S1) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** A **support** admin (the lowest role) could create credits. A credit at or below 50.000 BD posts to the shop's balance **at once**, with no second person.
- **Why:** The create route `POST /v1/admin/merchants/:id/credits` sat in the "any signed-in admin" group. Only approve and reject had the `finance` / `super_admin` gate.
- **What it breaks:** Any support login (the most widely given, most often phished one) can pay out up to 50 BD per call, as many times as it likes. The service's own doc says "a support caller gets a 403", and the admin UI already tells support "Your role cannot issue credits": only the server didn't enforce it.

## 1. The issue

```
support admin: POST /v1/admin/merchants/<m>/credits {baseAmountFils: 10000, ...}  -> 201 status 'posted'
ledger: merchant_payable +10.000 BD
```

## 2. Why it happened

`apps/api/src/routes/adminCredits.ts`: the first plugin scope only adds `requireAdminSession`, and both
`GET /credits` (a read: fine) and `POST /merchants/:id/credits` (a money write: not fine) live in it.

```ts
scope.addHook("preHandler", requireAdminSession);   // no role gate
scope.post("/merchants/:id/credits", ...)
```

`admin/credits.ts` `createCreditRequest`: "Requires finance or super_admin; a support caller gets a 403
from here." It never checked a role, and neither did the route.

## 3. The audit — every `/v1/admin` route

Rule used (ARCHITECTURE "roles checked server-side per route"; ADMIN.md: finance = "anything that
touches money or settlement"; HANDOVER on impersonation):

| Route | Gate before | Verdict |
|---|---|---|
| `POST /auth/login`, `/auth/otp/verify` | none (login) | OK |
| `GET /auth/me`, `POST /auth/logout` | session | OK |
| `GET /merchants`, `GET /merchants/:id` | session | OK (read) |
| `POST /merchants/:id/kyc-reviews` | finance+ | OK |
| `POST /merchants/bulk-approve` | finance+ | OK |
| `POST /merchants/:id/api-keys/:keyId/rotate` | finance+ | OK |
| `POST /merchants/:id/transactions/recompute-statuses` | finance+ | OK |
| `POST /merchants/:id/balance-adjustments` | finance+ | OK |
| `POST /merchants/:id/impersonate` | session | OK: HANDOVER/BUG-010, grant is read-only `support` |
| `POST /impersonation/:grantId/end` | session | OK: query is scoped to the admin's own grant |
| `POST /merchants/:id/webhook-endpoints/:e/replay-batch`, `/archive`, `/archive/:a/replay` | session | **Left as is** (ADMIN.md lets support replay webhooks). Noted as a risk: replaying `settlement.paid` can cause double payouts (see the Aug-21 incident). Candidate follow-up: gate money events to finance+ |
| `POST /adjustment-imports` | finance+ | OK |
| `GET /adjustment-imports`, `GET /adjustment-imports/:id` | session | OK (read) |
| `POST /settlement/run-batch`, `/balances/rebuild`, `/reporting/rebuild`, `/merchants/:id/mdr-recalculation` | finance+ | OK |
| `GET /credits` | session | OK (read) |
| **`POST /merchants/:id/credits`** | **session only** | ❌ **fixed → finance+** |
| `POST /credits/:id/approve`, `/reject` | finance+ | OK |

`requireAdminRole` itself is a plain `roles.includes(role)` check: correct.

ADMIN.md's role table also says support may "issue small credits" and super_admin may "make changes
while viewing as a merchant". Both disagree with the code-level docs (credits.ts, HANDOVER
impersonation rule, the admin UI), so ADMIN.md is the wrong one here (trust order: code → ADR →
HANDOVER → ARCHITECTURE → others).

## 4. Who was affected

| Party | How | How bad |
|---|---|---|
| FilsPay (finance) | Money paid out by the lowest-trust role, no second person | High |
| Merchants | Could receive unexplained credits | Low |

## 5. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/adminCredits.ts` | Create route gets `preHandler: requireAdminRole("finance", "super_admin")` (runs after the scope's session hook) |
| `apps/api/src/routes/adminCredits.test.ts` | New test: support → 403, no credit row, no ledger legs; am's "intentional?" note removed |

## 6. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Route-level `requireAdminRole("finance","super_admin")` on create | One line; same pattern as every other money route; matches UI and credits.ts doc | none | ✅ |
| 2 | Move create into the finance-gated scope | Also one move | Bigger diff, changes the plugin layout | |
| 3 | Let support create, but always force their credits into the approval queue (creative) | Support can still raise a credit for finance to approve | New rule nobody asked for; touches money logic | |
| 4 | Role check inside `createCreditRequest` (service) | Protects other callers | Service has no role input; bigger change | |

**Why #1:** smallest change that matches the documented rule and the existing UI.

## 7. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `a support admin is 403'd on create — a small credit would post money with no second person` | `apps/api/src/routes/adminCredits.test.ts` | ❌ `201 !== 403` (credit posted) | ✅ |
| Whole file (incl. unauthenticated → 401, finance create still works) | same | | ✅ 12/12 |

```bash
npx tsx --test apps/api/src/routes/adminCredits.test.ts
```

Existing tests changed: none.
