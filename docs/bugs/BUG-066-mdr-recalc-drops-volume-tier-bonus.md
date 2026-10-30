# BUG-066 — MDR recalculation drops the platform volume-tier discount

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Money · Settlement |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

## Summary

- **What's wrong:** once the platform has processed 2,000,000 BD, every batch is charged 15 bps less. "Recalculate MDR" re-rates those batches without the 15 bps discount, so the merchant is charged it again even when nothing changed.
- **Why:** `recomputeBatchFee` never applies `VolumeTierMdrBonusBps`; `CloseBatch` does.
- **What it breaks:** every merchant whose closed batches are recalculated after the tier is reached pays 0.15 % too much.

## Root cause

`CloseBatch` (`batch.go`) subtracts `tierBonusBps` from each event's rate. `recalculate_mdr.go`
`recomputeBatchFee` charged `ComputeSettlementFee(amount, mdrBps, discountBps)` with no tier bonus.

**Present in the original code:** `apps/settlement/internal/settlement/recalculate_mdr.go:157` at 8b58b0f
(no tier bonus), against `apps/settlement/internal/settlement/batch.go:141,209` at 8b58b0f (bonus applied at close).

## Fix

`RecalculateMDR` reads `platform_stats.total_processed_fils` once, computes
`VolumeTierMdrBonusBps`, and `recomputeBatchFee` subtracts it from each event's rate (clamped at 0),
the same rule as `CloseBatch`. The counter only grows, so the current bonus is the "current terms"
the recalculation is meant to apply.

Options: (1) apply the current bonus ✅; (2) store the bonus on each batch at close and reuse it
(exact, but needs a migration and backfill); (3) leave as is (overcharges).

## Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestRecalculateMDR_KeepsVolumeTierBonus` | `apps/settlement/internal/settlement/recalculate_mdr_tier_fix_test.go` | ❌ `adjusted fee 940 -> 1000 (diff 60); want no adjustment` | ✅ passes |

`cd apps/settlement && go test -p 1 ./...` green. Existing tests changed: none.
