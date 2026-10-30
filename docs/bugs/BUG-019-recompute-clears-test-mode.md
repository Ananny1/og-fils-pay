# BUG-019 — "Recompute transaction statuses" turns test merchants into live ones

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Settlement · Money |
| **Analysis ID** | S7 (see `docs/challenge/ANALYSIS.md`) |
| **Clue** | Test (sandbox) merchants appeared in the real settlement run and were paid |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** an admin presses "Recompute transaction statuses" on a **test** merchant. The merchant silently stops being a test merchant, and the next real settlement run **pays it real money**.
- **Why:** after recomputing, the route called `reconcileSandboxFlag`, which sets `test_mode = false` when the merchant has "no open authorizations". That count was **always 0**, because the scan that counts them excludes `authorized` transactions.
- **What it breaks:** test card traffic becomes real payouts. Money leaves FilsPay for transactions that were never real.

## 1. The issue

`POST /v1/admin/merchants/:id/transactions/recompute-statuses` on a merchant with `test_mode = true` and any captured transaction returned `flagsUpdated: ["test_mode"]` and the merchant row now had `test_mode = false`. The settlement service only skips merchants with `test_mode = true` (`apps/settlement/internal/settlement/batch.go:117,408`), so the merchant was settled next night.

## 2. Why it happened — the root cause

`apps/api/src/admin/transactionStatusRecompute.ts`:

```ts
WHERE merchant_id = $1 AND status NOT IN ('authorized', 'voided')   // authorized rows never scanned
...
if (row.status === "authorized") openAuthorizations += 1;           // so this never runs
```

`apps/api/src/admin/merchantFlags.ts` (called by the route):

```ts
if (summary.scanned > 0 && summary.openAuthorizations === 0) {
  await client.query(`UPDATE merchants SET test_mode = false WHERE id = $1`, [merchantId]);
```

A status tidy-up tool should never change a merchant's sandbox/live flag. `docs/ADMIN.md` describes the action as "tidies up transaction statuses … Safe to run more than once" — it says nothing about flags.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| FilsPay finance | Real payouts for test transactions | Critical: direct money loss |
| Merchants (test accounts) | Receive money they are not owed; later clawbacks | High |
| Acquirer / scheme | Settlement files contain test traffic | High |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/adminMerchantsRecompute.ts` | No longer calls `reconcileSandboxFlag`; `flagsUpdated` is always `[]` (same response shape for the console). |
| `apps/api/src/admin/merchantFlags.ts` | Deleted (its only caller was the route). |
| `apps/api/src/admin/transactionStatusRecompute.ts` | `openAuthorizations` is now a real `COUNT(*)` of `authorized` rows, so the number shown is true. |
| `apps/api/src/routes/adminMerchantsRecompute.test.ts` | New route test. |

Smallest correct change: remove the side effect that should never have been there, and fix the counter that made it fire.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Remove flag clearing from recompute + fix the counter | Small; the tool does only what its name says | Going live now needs a separate, explicit action (already exists as merchant status management) | ✅ |
| 2 | Only fix the counter (include `authorized`) | One query | Still clears `test_mode` for any test merchant with no open auths — the wrong behaviour remains | |
| 3 | DB trigger: `test_mode` can only go true→false with an audit row from a dedicated "go live" action (creative) | Protects every future path | Migration + new admin flow | |
| 4 | Settlement also checks a second sandbox marker (e.g. API key prefix `sk_test_`) | Defence in depth | Go change, wider scope | |

**Why we chose #1:** the clearing logic is the root cause; without it, test merchants cannot drift into live payouts through this tool.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-019: recompute statuses keeps a test merchant in test mode` | `apps/api/src/routes/adminMerchantsRecompute.test.ts` | ❌ `flagsUpdated` = `["test_mode"]`, flag cleared | ✅ flag kept, `openAuthorizations` = 1 |

```bash
npx tsx --test apps/api/src/routes/adminMerchantsRecompute.test.ts
```

Existing tests changed (and why): none (there were no tests for this route).
