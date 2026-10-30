# BUG-105 — Imported balance adjustments are never paid out or deducted

| | |
|---|---|
| **Severity** | High |
| **Area** | Money · Settlement |
| **Analysis ID** | new (bug hunt); same family as BUG-064 |
| **Clue** | `adjustmentImport.ts` posts to `merchant_payable`; `CloseBatch` never reads `adjustment_import_rows` |
| **Commit** | see `git log --grep BUG-105` |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** when finance imports a CSV of corrections, the shop's balance changes, but the money never moves. A +4.750 BD correction is never paid to the shop; a −2.000 BD correction is never taken back.
- **Why:** the daily settlement run (`CloseBatch`) adds up captures, credits (BUG-064) and refunds. It never reads imported adjustments.
- **What it breaks:** `merchant_payable` never returns to zero; the shop is under- or over-paid by every adjustment ever imported.

## 1. The issue

Import `merchantId,4.75,fix` in the admin console. The ledger gets `merchant_payable` +4750 and
the cached balance goes up. The next batch pays `gross − fee − refunds` only. The 4750 fils are
never in any payout. A negative row is never deducted either.

## 2. Root cause

`apps/api/src/admin/adjustmentImport.ts` (`postAdjustmentToLedgerAndCache`) calls
`postLedgerAdjustment` (`ledgerAdjustments.ts`), which credits or debits `merchant_payable`, and
bumps `merchant_balances.cached_payable_fils`. `apps/settlement/internal/settlement/batch.go`
`CloseBatch` builds the payout without them:

```go
netPayout := NetPayableFils(batchGross, batchFee)   // capture events only
```

**Present in the original code:** `apps/settlement/internal/settlement/batch.go:219` at 8b58b0f
(nothing reads `adjustment_import_rows`), with the ledger post at
`apps/api/src/admin/adjustmentImport.ts:28` at 8b58b0f.

Scope note: the console's **Adjust balance** button (`applyBalanceCorrection`) is cache-only by
ADR-0006 (a display correction, no ledger leg), so it is not money owed and is not settled.
`adjustMerchantBalanceJournaled` posts ledger legs but is not wired to any route and has no row to
claim; if it is ever exposed it needs the same treatment.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Positive corrections never paid to their bank | High |
| FilsPay finance | Negative corrections never recovered; `merchant_payable` never clears | High |
| Cardholders / scheme | — | none (not card volume) |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0118_adjustment_import_rows_settlement_batch.sql` | `adjustment_import_rows.settlement_batch_id` + partial index for the lookup |
| `apps/settlement/internal/settlement/batch.go` (Step 8c) | claim every unbatched, non-zero row with `created_at` before the end of the business day, `FOR UPDATE`. Positives are added to the net. Negatives are deducted oldest first; one that would make the net negative, and every negative after it, waits for a later batch |
| `batch.go` (Step 14) | cache delta at close is `net − credits − adjustments`, because the import already moved the cache |

Same exactly-once pattern as credits (0100) and refunds: claimed in the transaction that freezes
the batch; re-closing a closed batch is a no-op. Gross, fee, scheme export and platform volume are
unchanged. Runs after credits and before refunds.

Rollout note: rows imported before this migration are all unbatched, so the first batch after
deploy settles every historic adjustment. Finance should review
`SELECT * FROM adjustment_import_rows WHERE settlement_batch_id IS NULL AND parsed_amount_fils <> 0`
first in case any were settled by hand.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | CloseBatch claims unbatched adjustment rows (like credits/refunds) | Small, exactly-once, indexed, one function | Timing is "next batch" | ✅ |
| 2 | Separate adjustment payout/collection job | Clear separation | New payout path, duplicates PayoutBatch | |
| 3 | Sum unlinked `merchant_payable` ledger legs | Catches every source | No per-leg batch link; full scans | |

## 6. Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestCloseBatch_SettlesImportedAdjustments` | `apps/settlement/internal/settlement/adjustment_payout_fix_test.go` | ❌ | ✅ |

Before (no fix):
```
--- FAIL: TestCloseBatch_SettlesImportedAdjustments (0.09s)
    adjustment_payout_fix_test.go:95: NetPayoutFils = 9750, want 10750 (gross - fee + 3000 - 2000): imported adjustments are never settled
FAIL	github.com/filspay/settlement/internal/settlement	1.559s
```
After:
```
ok  	github.com/filspay/settlement/internal/settlement	1.595s
```
The test also checks: a too-large negative is carried forward (not claimed), a row imported after
the day waits for the next batch, nothing is settled twice, and ledger `merchant_payable` and the
cache agree (−46000) after payout. Full Go suite `go test -count=1 -p 1 ./...` green.
