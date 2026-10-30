# BUG-065 — MDR recalculation ignores the merchant's fee schedule

| | |
|---|---|
| **Severity** | High |
| **Area** | Money · Settlement |
| **Analysis ID** | new (bug hunt, settlement area) |
| **Clue** | `recalculate_mdr.go` reads only `merchants.mdr_bps`; `CloseBatch` reads `fee_schedules` |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-065` |
| **Owner** | Sayed |
| **Evidence** | Go test below |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** running "Recalculate MDR" on a merchant with a negotiated rate charges them their old rate again, even when nothing changed.
- **Why:** the recalculation uses `merchants.mdr_bps` (only the fallback rate) instead of the `fee_schedules` rate that the batch was actually charged at.
- **What it breaks:** merchants with a fee schedule are overcharged (or undercharged) on every closed batch the recalculation touches.

## 1. The issue — what was wrong

Seed merchant **beta-digital** has `merchants.mdr_bps = 180` and a fee schedule of **165 bps from
2026-09-06**. Its batches after that date are closed at 165 bps. If finance runs
"Recalculate MDR" over those dates — even with no rate change — every batch is re-rated at 180 bps
and the extra 0.15 % is taken off the unpaid payout and posted to `platform_fee_revenue`.
Example from the test: a 40.000 BD batch, fee 0.660 BD at close, rewritten to 0.720 BD.

## 2. Why it happened — the root cause

`apps/settlement/internal/settlement/recalculate_mdr.go`, `recomputeBatchFee`:

```go
// before
SELECT amount_fils FROM transaction_events WHERE settlement_batch_id = $1 ORDER BY id
...
fee += ComputeSettlementFee(money.Fils(amountFils), mdrBps, discountBps) // mdrBps = merchants.mdr_bps
```

**Present in the original code:** `apps/settlement/internal/settlement/recalculate_mdr.go:142,157` at 8b58b0f.

Migration `0048_fee_schedules.sql` says the rate actually applied at capture and settlement is
resolved from `fee_schedules`, falling back to `merchants.mdr_bps`. `CloseBatch` and
`capture.ts` do that (`EffectiveMdrBpsAt` per event). The recalculation did not, so it compared
the batch's real fee against a different rate rule.

False claim kept it hidden: `0048_fee_schedules.sql` "AM: 'current rate' = the latest row by
created_at ... that's what recalculate-MDR applies" — the recalculation never read
`fee_schedules` at all.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | — | none |
| Merchants with a fee schedule | Charged the fallback rate on recalculated batches | High: wrong fee taken from payout |
| FilsPay (finance / ops) | Fee revenue and merchant statements don't match the agreed rate | High |
| Acquirer / card scheme / partners | — | none |

## 4. The fix

| File | Change |
|---|---|
| `apps/settlement/internal/settlement/recalculate_mdr.go` | `RecalculateMDR` loads the merchant's fee schedules once; `recomputeBatchFee` reads each event's `occurred_at` and charges `EffectiveMdrBpsAt(schedules, occurredAt, mdrBps)` |

```go
// after
SELECT amount_fils, occurred_at FROM transaction_events WHERE settlement_batch_id = $1 ORDER BY id
...
fee += ComputeSettlementFee(money.Fils(amountFils), EffectiveMdrBpsAt(schedules, occurredAt, mdrBps), discountBps)
```

The recalculation now uses the same per-event rate rule as `CloseBatch`. For a merchant with no
schedule rows nothing changes (fallback = `merchants.mdr_bps`, existing tests unchanged). A real
rate change is a new `fee_schedules` row, and the recalculation applies it. One extra indexed
query per run (`fee_schedules_merchant_effective_idx`).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Use `EffectiveMdrBpsAt` per event, like CloseBatch | Same rule everywhere; no-op when nothing changed | — | ✅ |
| 2 | Use the newest schedule row as "current rate" for every event | Matches the 0048 comment | Re-rates events at a rate not in force when they happened; contradicts 0048's own rule | |
| 3 | Disable recalculation for merchants with a schedule | Safe | Removes a finance tool | |

**Why we chose #1:** the batch fee and its recalculation must use one rule, or a recalculation
moves money with no rate change.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestRecalculateMDR_UsesFeeScheduleRate` | `apps/settlement/internal/settlement/recalculate_mdr_schedule_fix_test.go` | ❌ `adjusted fee 660 -> 720 (diff 60)` with no rate change | ✅ no adjustment; a new schedule row is applied |

```bash
cd apps/settlement && go test -p 1 ./...
```

Existing tests changed: none. Go suite green.

Not fixed here (reported): the recalculation also leaves out the platform volume-tier bonus
(`VolumeTierMdrBonusBps`) that `CloseBatch` subtracts, so once the platform passes 2,000,000 BD a
no-change recalculation would add 15 bps back. Needs a decision on which bonus applies (at close
or now), since the close-time bonus is not stored.
