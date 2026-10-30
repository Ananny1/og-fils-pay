# BUG-017 — "Rebuild cached balances" button reads the scheme export, not the ledger

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Money · Settlement |
| **Analysis ID** | B1 (see `docs/challenge/ANALYSIS.md`), ticket FP-203 |
| **Clue** | Support: a merchant's balance dropped from 135K to 7K after pressing the button |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** the admin "Rebuild cached balances" button sets every merchant's balance to a wrong number (one shop went **135K → 7K**).
- **Why:** the button reads the view `merchant_payable_position`, which only adds up **scheme export lines** (gross card amounts of closed batches). It ignores fees, refunds, payouts, adjustments and everything not yet exported. The real source is the **ledger**.
- **What it breaks:** cached balances shown to merchants and used by payouts become wrong for every merchant, in one click.

## 1. The issue

`POST /internal/rebuild-balances` (behind the console button) and the CLI `settlement rebuild-balances` give different answers. The CLI is right. The button overwrote `merchant_balances` with export totals.

## 2. Why it happened — the root cause

`apps/settlement/internal/internalapi/server.go` `handleRebuildBalances` called `ledger.RefreshBalanceCache`, which reads:

```sql
-- db/migrations/0054_views.sql
CREATE OR REPLACE VIEW merchant_payable_position AS
SELECT sb.merchant_id, COALESCE(SUM(sel.amount_fils), 0) AS payable_fils
  FROM scheme_export_lines sel JOIN settlement_batches sb ON sb.id = sel.settlement_batch_id
 GROUP BY sb.merchant_id;
```

That is gross exported money, not what FilsPay owes the merchant.

False claims that hid it (traps):
- `docs/adr/0004-balance-rebuild-source.md` — "They agree whenever the cache is consistent with settled activity." **False**: they disagree as soon as any fee, refund, payout or adjustment exists. It conflicts with HANDOVER "Balances": *"The only way to rebuild `merchant_balances` is the CLI, which reads the ledger … there shouldn't be one that reads anything else."* (HANDOVER outranks ADR-0004 in the trust order after ADR-0001/0002.)
- `internalapi/server_test.go` — "FH: 12000 = export total = what support sees in the console, so the test is right". **False**: the test encoded the bug.
- `server.go` comment on `rebuildDiffResponse` said "After is the ledger-derived balance" — it was not, until this fix.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Balance shown and paid from is wrong (too high or too low) | Critical |
| FilsPay finance | Cache no longer matches the ledger; overpay/underpay risk | Critical |
| Customers / scheme | Not directly | — |

## 4. The fix

| File | Change |
|---|---|
| `apps/settlement/internal/internalapi/server.go` | `handleRebuildBalances` calls `ledger.RebuildAllBalances` (the CLI's ledger-only rebuild) instead of `ledger.RefreshBalanceCache`. |
| `apps/settlement/internal/internalapi/server_test.go` | Test adds a 300 fils fee leg and expects the ledger result 11700, not the export total 12000. |

```go
diffs, err := ledger.RebuildAllBalances(r.Context(), pool)
```

Smallest correct change: one call. The button and the CLI now share one function, so they cannot drift again. The response shape is unchanged, so the admin console needs no change.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Button calls `RebuildAllBalances` (same as CLI) | One line; one source of truth (ledger); HANDOVER-compliant | Slower on huge ledgers (ADR-0004's 40 s concern) | ✅ |
| 2 | Rewrite `merchant_payable_position` view to sum `ledger_entries` | Fixes other readers of the view too | Changes a shared view (migration); other code may rely on export totals | |
| 3 | Remove the button entirely (HANDOVER: "there is no console button") | Zero risk | Support loses a tool; UI work | |
| 4 | Run the rebuild as a background job, button shows "started" + diff later (creative) | No HTTP timeout even on huge data | Needs a job table and polling UI | |

**Why we chose #1:** it removes the wrong source with the smallest change. If the 30 s timeout becomes real, option 4 is the follow-up.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestRebuildBalances_ValidToken` | `apps/settlement/internal/internalapi/server_test.go` | ❌ after = 12000, want 11700 | ✅ |
| ledger package tests | `apps/settlement/internal/ledger/` | ✅ | ✅ |

```bash
cd apps/settlement && DATABASE_URL=... go test ./internal/internalapi/ ./internal/ledger/
```

Existing tests changed (and why): `TestRebuildBalances_ValidToken` asserted the export total (the bug). It now seeds a fee leg and asserts the ledger total. `RefreshBalanceCache` is left in place (no longer called by the API) to keep the change minimal.
