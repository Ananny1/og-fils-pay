# BUG-017 — Admin "Rebuild cached balances" overwrites balances with scheme totals (135K → 7K)

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Settlement · Money |
| **Analysis ID** | B1 |
| **Clue** | FP-203: Alpha's balance dropped from ~135K to ~7K BD after support pressed the button; ADR-0004 |
| **Commit** | see `git log --grep BUG-017` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

Support presses **Rebuild cached balances** in the admin console and merchants' payable balances
change to unrelated numbers (Alpha: ~135K BD → ~7K BD). Running the CLI `settlement
rebuild-balances` gives different (correct) numbers. Reproduce: a merchant with 12.000 BD captured
and a 0.300 BD fee has a ledger payable of 11.700 BD; the button sets the cache to 12.000 BD.

## 2. Why it happened — the root cause

`apps/settlement/internal/internalapi/server.go:268`

```go
diffs, err := ledger.RefreshBalanceCache(r.Context(), pool)
```

`RefreshBalanceCache` (`ledger/refresh.go`) reads the `merchant_payable_position` view
(`0054_views.sql`):

```sql
SELECT sb.merchant_id, COALESCE(SUM(sel.amount_fils), 0) AS payable_fils
  FROM scheme_export_lines sel JOIN settlement_batches sb ...
```

That is the sum of truncated **gross** amounts ever exported — no fees, no payouts, no refunds,
nothing before export. It is not a balance. The CLI uses `ledger.RebuildAllBalances`, the sum of
`merchant_payable` legs in `ledger_entries`, which is the only authoritative source.

False claim: ADR-0004 ("rebuilds from … settled data … They agree whenever the cache is
consistent"). HANDOVER: "There is no console button, and there shouldn't be one that reads
anything else" than the ledger. The internalapi test even said "the rebuild endpoint's source of
record is a closed batch's own scheme-export line".

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | dashboard balance wrong after every button press | High |
| FilsPay finance / support | wrong balances used for decisions, payouts look owed/missing | Critical |

## 4. The fix

| File | Change |
|---|---|
| `apps/settlement/internal/internalapi/server.go:268` | call `ledger.RebuildAllBalances` (same as the CLI) |

One call changed; response shape unchanged (`RebuildAllBalances` returns the same
`map[uuid]RebuildDiff`). `RefreshBalanceCache` and the view are left in place (unused by the
button) to keep the change minimal; they can be deleted later.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Button calls `RebuildAllBalances` | one source of truth, same as CLI | ledger walk is slower (ADR-0004's 40 s concern) | ✅ |
| 2 | Redefine the view as the ledger sum | button unchanged | two code paths to keep equal | |
| 3 | Remove the button | no wrong numbers | support loses the tool | |

**Why #1:** correctness first. If the 40 s timeout is real on production data, the next step is a
single `GROUP BY merchant_id` query in `RebuildAllBalances` (served by
`idx_ledger_entries_merchant_occurred`), not a different source.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestRebuildBalances_UsesLedgerNotSchemeLines` | `apps/settlement/internal/internalapi/rebuild_fix_test.go` | ❌ after = 12000 | ✅ 11700 |

```bash
cd apps/settlement && go test ./internal/internalapi/ -run UsesLedger -count=1
```

Existing tests changed: none.
