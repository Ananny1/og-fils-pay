# FP-300.5 (reconciliation) — a period with refunds explains to zero gap

| | |
|---|---|
| **Severity** | Feature (missing) · ★★ |
| **Area** | Refunds (FP-300) · Settlement reconciliation |
| **Analysis ID** | R9 (reconciliation part), §4 checklist item 8 |
| **Clue** | FP-300 sheet "reconciliation ties out"; `getReconciliationReport` comment "Refund legs are included both in the ledger figure and in pending" (false) |
| **Owner** | Stream S6 |
| **Status** | ✅ done |

## Summary (the short note)

- **What was wrong:** after a refund that no batch had deducted yet, `GET /v1/settlement/reconciliation`
  showed an unexplained gap equal to the refund's cost (amount − fee reversed), and `explained: false`.
  Finance would see "books don't match" every day a refund happened.
- **Why:** the refund's ledger legs lower `merchant_payable` the moment it happens, but the "pending" figure
  only added up unbatched **captures**. Nothing subtracted refunds that are still waiting for a batch.
- **Trap:** the comment above `ReconciliationReport` said refunds were already in pending. Verified against
  the code: false. (For the team: add to `TRAPS.md`.)
- **Who was affected:** every merchant with a refund in the period, on the merchant reconciliation page and
  in the assistant's reconciliation tool (same function).

## 4. The change

| File | Change |
|---|---|
| `apps/api/src/settlement/query.ts` | one more query in the same `Promise.all`: refunds of the period **not** taken off a closed/paid batch of the period are subtracted from pending; refunds from **before** the period that a batch of the period took off are added back (Go CloseBatch can defer a refund to a later batch when it would make a payout negative, FP-300.3). Comment corrected. |
| `apps/api/src/routes/settlement.test.ts` | two new tests (below) and two small helpers |

Rule, in words: captured − fees − refunds (ledger) = paid in batches + still pending.
Integer fils only; Bahrain business-day window, the same as the other three figures.

The new query reads one merchant's refunds up to the period end, keyed by `merchant_id` — refunds are a
small fraction of sales, so this is cheap next to the capture-events query already there.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Subtract not-yet-deducted refunds from pending, add carried-in ones | Gap is 0 in every case; same 4 fields, no API change | One extra query | ✅ |
| 2 | Only subtract unbatched refunds (`settlement_batch_id IS NULL`) | Simplest | A refund deducted by a later batch shows a gap in both periods | |
| 3 | New `refundsFils` field in the report | Clearer breakdown | Changes the web page and assistant contract; not needed to tie out | |
| 4 | Exclude refund legs from the ledger figure | No new query | Hides real money movement — the ledger figure must be the truth | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| `FP-300.5: reconciliation explains an unbatched refund to zero gap` — 10.000 BD captured, 4.000 BD refunded, no batch: pending = ledger = 10000 − fee − (4000 − fee reversed), gap 0 | `apps/api/src/routes/settlement.test.ts` | ❌ pending 9750 (refund ignored), gap −3900 | ✅ |
| `FP-300.5: reconciliation explains a refund the batch deducted to zero gap` — batch claims the refund like Go step 9 | same | ✅ | ✅ (guards the batched path) |
| other settlement / analytics route tests | same + `analytics.test.ts` | ✅ | ✅ (25/25) |

Existing tests changed: none. The admin console has no reconciliation endpoint of its own (its settlement
page has no reconciliation call), so there was nothing to change there.
