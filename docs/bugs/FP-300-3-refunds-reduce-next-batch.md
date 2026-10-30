# FP-300.3 — Refunds are deducted from the merchant's next settlement batch

| | |
|---|---|
| **Severity** | High (money: payouts ignore refunds) · ★★★ |
| **Area** | Refunds (FP-300) · Settlement (Go) |
| **Analysis ID** | R9 · decision Q-2 |
| **Clue** | S2 FP-300 sheet: "payouts" / "reduce the next batch" |
| **Owner** | Stream S6 |
| **Status** | ✅ done |

## Summary (the short note)

- **What was missing:** A shop refunds 4.000 BD today, but tonight's payout still pays it the full day's sales. FilsPay pays the refunded money twice: once back to the card, once to the shop.
- **Why:** `CloseBatch` (Go) only summed capture events. It never looked at `refunds`, even though `refunds.settlement_batch_id` and the index `idx_refunds_merchant_unbatched` (migration 0042) were built for exactly this claim.
- **What we did:** `CloseBatch` now claims every unbatched succeeded refund up to the end of the business day and takes its cost off the payout (decision **Q-2**: deduct from the next batch).

## 1. The issue

Test (before): capture 10 000 fils (fee 250), refund 4 000 (fee reversed 100) the same day → batch `net_payout_fils = 9 750`;
refund row never linked to a batch, so no batch ever deducts it.

## 4. The change

| File | Change |
|---|---|
| `apps/settlement/internal/settlement/batch.go` | new step in `CloseBatch`, same transaction as the frozen totals: select `refunds` (`merchant_id`, `succeeded`, `settlement_batch_id IS NULL`, `occurred_at <` end of the business day) oldest first `FOR UPDATE`; deduct `amount_fils − fee_reversed_fils` from `netPayout`; set `settlement_batch_id`; `BatchResult` gains `RefundCount` and `RefundDeductedFils` |
| `apps/settlement/internal/settlement/refund_batch_test.go` | 2 new DB tests (below) |
| `apps/settlement/internal/settlement/recalculate_mdr.go` | (review fix) `RecalculateMDR` set `net = gross − newFee`, which put the refund deduction back into the payout. Now `net = oldNet − (newFee − oldFee)`, so the deduction is kept; the balance cache already moved by `−(newFee − oldFee)`, so batch and cache agree again |
| `apps/settlement/internal/settlement/refund_batch_test.go` | (review fix) `TestRecalculateMDR_KeepsRefundDeduction` |
| `apps/api/src/settlement/query.ts`, `apps/settlement/internal/internalapi/server_test.go` | (review fix) comments: `net = gross − fee − refunds claimed`; `gross − fee` only when there are no refunds |

Rules:
- **Cost to the shop** = refund amount − fee given back (the ledger already debits `merchant_payable` by exactly this at refund time, so the payout and the ledger now agree).
- **Never a negative payout:** a refund that does not fit in today's net (and every later one, to keep order) waits for a later batch.
- **Exactly once:** claimed by `settlement_batch_id` under row locks in the batch's own transaction; re-closing a batch is still a no-op.
- No new migration: the column and index already existed (0042).
- **MDR recalculation keeps the deduction (review fix).** A refund stays linked to the batch that claimed it, so if `RecalculateMDR` rebuilt net from `gross − fee` the refunded money would be paid twice. It now changes net only by the fee difference. Options for this fix: (1, chosen) `oldNet − feeDiff`: one line, matches the cache delta already posted; (2) re-sum the batch's linked refunds and set `gross − newFee − refunds`: same answer, one more query; (3) store `refund_deducted_fils` on the batch: clearest, but needs a migration. Note: a fee increase on a batch whose net is almost all refunds could take net below zero; same as before the fix for any small batch, left for FP-300.5.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Claim unbatched refunds in `CloseBatch`, deduct cost, carry forward what doesn't fit | Uses the schema already built for it; atomic with the batch; payout never negative | A shop with only refunds for many days waits for sales to recover the money | ✅ |
| 2 | Allow a negative net and post a "merchant owes us" leg | Deducts immediately | `PayoutBatch`, splits and the balance cache all assume net ≥ 0; large change | |
| 3 | Report-only: show refunds on the batch, don't change net (other Q-2 choice) | No money logic touched | Double payment continues; the sheet asks for payouts to be right | |
| 4 (creative) | Pull the money back from the shop's bank by direct debit when net would be negative | Recovers money fast | Needs a bank integration that doesn't exist | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| `TestCloseBatch_DeductsRefundsFromNet` (net = 10 000 − 250 − 3 900 = 5 850; refund linked; re-close no-op) | `apps/settlement/internal/settlement/refund_batch_test.go` | ❌ net 9 750, refund unlinked | ✅ |
| `TestCloseBatch_RefundLargerThanNetCarriesForward` (day 1 can't absorb 1 950 → carried; day 2 net 4 875 − 1 950 = 2 925) | same | ❌ day 2 net 4 875, refund never claimed | ✅ |
| `TestRecalculateMDR_KeepsRefundDeduction` (10 000 capture, 3 900 refund cost, MDR 250→300 bps: net must be 10 000 − 300 − 3 900 = 5 800; cache moves by the same −50 as the batch) | same | ❌ net 9 700 (refund added back), cache moved −50 but batch +3 850 | ✅ |
| whole Go suite | `go test ./...` | ✅ | ✅ |

```bash
cd apps/settlement && DATABASE_URL=postgres://filspay:filspay_dev_password@127.0.0.1:5433/filspay_s6 go test ./...
```

Not in this change: reconciliation / reports showing refunds per batch (FP-300.5), and the 0072 matview join (R7).
