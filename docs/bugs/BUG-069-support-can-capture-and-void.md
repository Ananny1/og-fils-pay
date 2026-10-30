# BUG-069 — A merchant `support` user can capture or void payments

| | |
|---|---|
| **Severity** | High |
| **Area** | Security · Money |
| **Analysis ID** | — (new; related to the `TODO(FH): role check?` on void) |
| **Clue** | `TransactionDetailPage.tsx` hides Capture/Void from `support` "a support agent looks things up, they don't move money"; `RequireRole.tsx` "MK: the server enforces roles" |
| **Decision** | — |
| **Commit** | see `git log --grep "BUG-069"` |
| **Status** | ✅ fixed |

**Present in the original code:** `apps/api/src/routes/transactions.ts:95` and `:123` at 8b58b0f (`{ preHandler: requireMerchantAuth }` on capture and void).

## 1. The issue — what was wrong

The dashboard hides the Capture and Void buttons from `support` users, but
the API did not check the role. A `support` user with a normal dashboard
session could call `POST /v1/transactions/:id/capture` or `/void` directly
(browser devtools, curl with the cookie) and it worked: 200, money captured
(merchant payable credited, fee posted) or the authorization cancelled.

Reproduce: log in as a `support` merchant user, take an authorized
transaction id, `POST /v1/transactions/<id>/void` with the session cookie
→ 200 `voided`.

## 2. Why it happened — the root cause

`apps/api/src/routes/transactions.ts:94` and `:122` only used
`requireMerchantAuth` ("any logged-in actor of this merchant"):

```ts
// before
"/:id/capture",
{ preHandler: requireMerchantAuth },
...
// TODO(FH): role check? finance role users shouldn't void. ask MK
"/:id/void",
{ preHandler: requireMerchantAuth },
```

Every other money-moving merchant route (payment-link create/cancel, refunds,
webhooks, reconciliation) is gated with `requireMerchantRole("owner", "finance")`.
The UI comment "MK: UI gate only. the server enforces roles" was false for
these two routes, so the hidden button looked like a boundary.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | A support user could capture a held amount the shop never meant to take, or void an order the shop meant to charge | Medium |
| Merchants | Lowest-privilege staff (or a stolen support login) could move money / cancel sales | High |
| FilsPay (finance / ops) | Capture posts ledger + fee rows from an actor who has no money authority | Medium |
| Acquirer / card scheme / partners | — | — |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/transactions.ts` | capture and void get `[requireMerchantAuth, requireMerchantRole("owner", "finance")]` |

```ts
// after
{ preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] },
```

Same guard and same role list the UI already uses and every other
money route uses. API keys keep working (`requireMerchantRole` lets keys
through, they are owner-issued), and impersonation was already read-only.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Add `requireMerchantRole("owner","finance")` to both routes | One line each, existing guard, matches UI | — | ✅ |
| 2 | Owner-only for void (per the FH TODO) | Stricter | Breaks finance users the UI lets void; no spec for it | |
| 3 | Leave it UI-only | No change | Not a security boundary | |

**Why we chose #1:** it matches the role list the dashboard already shows and the gate on every other money route.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `support session cannot capture; the transaction stays authorized` | `apps/api/src/routes/transactions.roles.new.test.ts` | ❌ 200 | ✅ 403 |
| `support session cannot void; the transaction stays authorized` | same | ❌ 200 | ✅ 403 |
| `owner and finance sessions can still capture and void; API keys still can` | same | ✅ | ✅ |

```bash
cd apps/api && npx tsx --test src/routes/transactions.roles.new.test.ts src/routes/transactions.test.ts
```

Existing tests changed: none. Note: the comment in
`apps/web/src/pages/transactions/TransactionDetailPage.tsx` saying the hide is
"NOT backed by a matching server-side role check" is now out of date (frontend, left for Sayed).
