# BUG-018 — MDR recalculation rewrites batches that were already paid

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Settlement · Money |
| **Analysis ID** | S6 |
| **Clue** | `recalculate_mdr_test.go` (MK: "history gets rewritten at the new rate, that's intended"); `balances/cache.go` (FH: "ok on a PAID batch? that payout already went out") |
| **Commit** | see `git log --grep BUG-018` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

Finance changes a merchant's MDR and runs "Recalculate MDR" over a date range. Batches in that
range that were **already paid** get new `fee_fils` and `net_payout_fils`, a ledger adjustment and
a cache change. The batch record now says the merchant was paid 38.800 BD when the bank transfer
was 39.000 BD. Statements, reports and reconciliation against the bank no longer match.

## 2. Why it happened — the root cause

`apps/settlement/internal/settlement/recalculate_mdr.go:63-70`

```sql
WHERE merchant_id = $1 AND batch_date >= $2 AND batch_date < $3
  AND status <> 'open'           -- includes 'paid'
```

then for each batch: `UPDATE settlement_batches SET fee_fils = $2, net_payout_fils = $3`, a ledger
adjustment and `ApplyBatchClose(-diff)`. The type comment itself says "the original batch's figures
stay as they were paid" — the query contradicts it.

Trap: the "intended" note on the test and MK's reply in `cache.go`.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | statements show a payout different from what they received | High |
| FilsPay finance | frozen settlement history silently changed; bank reconciliation breaks | Critical |

## 4. The fix

| File | Change |
|---|---|
| `apps/settlement/internal/settlement/recalculate_mdr.go:67` | `status = 'closed'` instead of `status <> 'open'` |

Closed-but-unpaid batches are still recalculated (their payout has not happened, so the new net is
what gets paid). Paid batches are never rewritten. One condition changed.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Only recalculate `closed` batches | one line; frozen history stays true | a rate change can't retro-correct paid batches | ✅ |
| 2 | For paid batches post a forward correction (ledger + deduct from next payout) without rewriting | full retro pricing | needs "carry-forward" support in PayoutBatch that doesn't exist; larger change | |
| 3 | Keep rewriting paid batches | none | falsifies history | |

**Why #1:** it removes the harm with the smallest change. Retro-pricing paid batches is a product
decision that needs a carry-forward mechanism; listed for the team.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestRecalculateMDR_LeavesPaidBatchesUntouched` | `apps/settlement/internal/settlement/recalculate_mdr_fix_test.go` | ❌ fee 1000→1200 on a paid batch, 2 adjustment legs | ✅ untouched |

```bash
cd apps/settlement && go test ./internal/settlement/ -run RecalculateMDR -count=1
```

Existing tests changed: none (they only use closed batches). Also noted, not fixed:
`recomputeBatchFee` ignores effective-dated fee schedules and the platform tier bonus that
`CloseBatch` applies, so a recalculation of a batch spanning a schedule change can differ from a
fresh close.
