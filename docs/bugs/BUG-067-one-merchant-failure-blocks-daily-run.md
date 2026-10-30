# BUG-067 — One failing merchant stops the whole daily settlement run

| | |
|---|---|
| **Severity** | High |
| **Area** | Money · Settlement |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

## Summary

- **What's wrong:** if closing or paying one merchant fails, no merchant after it (in id order) is closed or paid that day.
- **Why:** `RunDailyBatch` returns on the first merchant error; the daemon then also skips payout notifications.
- **What it breaks:** healthy merchants are not paid. The daemon only ever retries "yesterday", so if the failure lasts past the next midnight, those merchants' captures for that day are left out of every payout until someone runs `run-batch --date` by hand.

## Root cause

`apps/settlement/internal/settlement/batch.go` `RunDailyBatch`:

```go
closeResult, err := CloseBatch(ctx, db, merchantID, businessDate)
if err != nil {
    ...
    return report, fmt.Errorf("settlement: RunDailyBatch: CloseBatch(%s): %w", merchantID, err)
}
```

Same `return` after `IsSplitParent`, `PayoutSplitBatch` and `PayoutBatch`. `scheduler/daemon.go`
returned on that error before `EnqueuePayoutNotifications`.

**Present in the original code:** `apps/settlement/internal/settlement/batch.go:439,448,455,461` at 8b58b0f
and `apps/settlement/internal/scheduler/daemon.go:95` at 8b58b0f.

## Fix

- `RunDailyBatch` records each merchant's error and carries on with the next merchant (each one is
  its own transactions, so nothing is half-done); it stops early only if the context is cancelled.
  It returns `errors.Join(failures...)`, so `run-batch` and `/internal/run-batch` still report failure.
- The daemon logs the error but still enqueues `settlement.paid` for the merchants that were paid.

Options: (1) carry on and report all failures ✅; (2) make the daemon also retry older unclosed
days (bigger change, still blocked by the poison merchant); (3) parallel per-merchant workers (not needed).

## Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestRunDailyBatch_OneFailingMerchantDoesNotBlockOthers` | `apps/settlement/internal/settlement/daily_batch_isolation_fix_test.go` | ❌ `healthy merchant has no batch for the day (blocked by the failing one): no rows in result set` | ✅ healthy merchant's batch is `paid`, run still returns an error |

The test makes the first merchant fail with a 100,000,000 BD capture (too big for
`scheme_export_lines.amount NUMERIC(10,2)`); any per-merchant error behaves the same.
`cd apps/settlement && go test -p 1 ./...` green. Existing tests changed: none.
