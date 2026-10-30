# BUG-018 — MDR recalculation rewrites batches that were already paid

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Settlement · Money |
| **Analysis ID** | S6 (see `docs/challenge/ANALYSIS.md`) |
| **Clue** | Admin "Recalculate MDR" changed figures of batches finance had already paid out |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** when an admin runs "Recalculate MDR" after a rate change, the system also changes **batches that were already paid**. Their fee and net payout are overwritten, and extra ledger lines and a cache change are posted.
- **Why:** the query picks every batch with `status <> 'open'`. That includes `paid`, not just `closed`.
- **What it breaks:** the paid batch no longer shows what the merchant actually received. Statements, reconciliation and the merchant's balance all change after the money already left.

## 1. The issue

Close a batch, mark it paid, change the merchant's `mdr_bps`, run Recalculate MDR over that date: the paid batch's `fee_fils` and `net_payout_fils` change, two MDR adjustment legs are posted and `merchant_balances` moves.

## 2. Why it happened — the root cause

`apps/settlement/internal/settlement/recalculate_mdr.go` (batch scan):

```sql
WHERE merchant_id = $1 AND batch_date >= $2 AND batch_date < $3
  AND status <> 'open'     -- includes 'paid'
```

then `UPDATE settlement_batches SET fee_fils = $2, net_payout_fils = $3 WHERE id = $1` for each one.

False claims that hid it (traps):
- `recalculate_mdr.go` `BatchAdjustment` doc — "the correcting ledger group lands in the current period's batch, so the original batch's figures stay as they were paid". **False**: the code updates the original batch row and posts against the old batch id.
- `recalculate_mdr.go` — "am: posts against the OLD batch id … fixed in FP-244 i think". **False**: not fixed.
- `recalculate_mdr_test.go` — "MK: this is the finance flow. history gets rewritten at the new rate, that's intended." True only for unpaid batches; the test uses a `closed` batch, so it still passes after the fix.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Paid batch figures and balance change after payout; looks like they owe money or are owed money | Critical |
| FilsPay finance | Paid batches no longer match bank payouts; reconciliation breaks | Critical |
| Acquirer / scheme | Not directly | — |

## 4. The fix

| File | Change |
|---|---|
| `apps/settlement/internal/settlement/recalculate_mdr.go` | Batch scan uses `status = 'closed'` instead of `status <> 'open'`; corrected the false doc comments. |
| `apps/settlement/internal/settlement/recalculate_mdr_test.go` | New `TestRecalculateMDR_PaidBatchUntouched`. |

```sql
AND status = 'closed' -- BUG-018: never rewrite a paid batch (or an open one)
```

Smallest correct change: one condition. Closed-but-unpaid batches still get the new rate (the finance flow); paid ones are frozen.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Only recalculate `status = 'closed'` | One line; paid history is safe; matches ANALYSIS | A rate change for already-paid days is not applied automatically | ✅ |
| 2 | For paid batches, post the difference as a new adjustment in the current open period, don't touch the old batch | Finance still collects/refunds the difference | More code (find/create current batch); needs finance sign-off on the policy | |
| 3 | Reject the request if the range contains any paid batch | Very explicit for the admin | Blocks the valid part of the request | |
| 4 | Database trigger that refuses UPDATE of fee/net on `paid` batches (creative) | Protects against every future code path too | Migration; may break legitimate ops tools | |

**Why we chose #1:** it is the smallest fix that stops money history changing after payout. Option 2 is the follow-up if finance wants retro-charging.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestRecalculateMDR_PaidBatchUntouched` | `apps/settlement/internal/settlement/recalculate_mdr_test.go` | ❌ adjusted 1, fee 119→142, 2 legs posted | ✅ |
| existing `TestRecalculateMDR_*` | same | ✅ | ✅ |

```bash
cd apps/settlement && DATABASE_URL=... go test ./internal/settlement/ ./internal/internalapi/
```

Existing tests changed (and why): none.
