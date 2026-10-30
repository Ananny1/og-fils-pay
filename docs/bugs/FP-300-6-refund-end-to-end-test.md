# FP-300.6 — one end-to-end refund test across every system

| | |
|---|---|
| **Severity** | Feature (test) · ★★ |
| **Area** | Refunds (FP-300) · all downstream systems |
| **Analysis ID** | §4 checklist item 9 |
| **Clue** | FP-300 sheet "looks easy, it isn't, it touches everything" |
| **Owner** | Stream S6 |
| **Status** | ✅ done |

## Summary (the short note)

- **What was missing:** each refund piece (route, ledger, batch, webhook, timeline, reports, reconciliation)
  had its own test, but nothing proved they agree with each other for **one** refund.
- **What the test does:** authorize + capture 10.000 BD (MDR 250 bps), refund 4.000 BD through
  `POST /v1/merchants/:merchantId/refunds`, then checks:

| # | System | Check |
|---|---|---|
| 1 | Ledger | every entry group of the transaction balances (debits = credits); `merchant_payable` = 10000 − fee − (4000 − fee reversed), to the fil; fee reversed = 4000's share of the fee |
| 2 | Webhook | the dispatcher sends exactly one `refund.succeeded` to the merchant's endpoint, with the right `refundId` / `amountFils`, a valid signature, delivery `succeeded` |
| 3 | Next batch | the one unbatched succeeded refund is exactly the row Go `CloseBatch` step 9 reads; the batch net it must produce equals what the ledger owes |
| 4 | Timeline | `GET /v1/transactions/:id/events` has `refund_partial`, −4000 fils, status after = `partially_refunded` |
| 5 | Reports | the reporting consumer's own `applyEvent`, run on the real outbox row, adds 1 refund / 4000 fils to today's Bahrain-date rollup |
| 6 | Reconciliation | ledger figure = pending = batch net; gap 0, `explained: true` |

- **Go part:** the batch close runs in Go, so this test asserts the data it reads and the net it must reach;
  the deduction itself is proven by `TestCloseBatch_DeductsRefundsFromNet` and
  `TestCloseBatch_RefundLargerThanNetCarriesForward` (`apps/settlement/internal/settlement/refund_batch_test.go`).
- **Reports part:** the test calls `applyEvent` for this one outbox row instead of a whole consumer pass, so it
  does not move the shared reporting watermark or depend on other tests' events. "Exactly once" is proven
  by `runConsumerPass.test.ts` (FP-300.5 reports commit).

## 4. The change

| File | Change |
|---|---|
| `apps/api/src/refunds/refundEndToEnd.test.ts` | new: the test above (imports the reporting applier from `apps/reporting/src`, the same source the worker runs) |

No production code changed.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | One API test + reference the Go batch tests | Runs in the normal `npm test`; real HTTP route, real DB | Batch close is asserted by its inputs, not by calling Go | ✅ |
| 2 | Shell out to the Go binary from the test | Fully real close | Needs Go in the api container; slow and brittle | |
| 3 | Re-implement CloseBatch in TS for the test | Self-contained | A second copy of the batch rule that can drift | |

## 6. Proof

| Test | File | Result |
|---|---|---|
| `FP-300.6: a partial refund flows through ledger, webhook, next batch, timeline, reports and reconciliation` | `apps/api/src/refunds/refundEndToEnd.test.ts` | ✅ (passes on the FP-300.5 commits; before them, steps 4–6 fail: no status in the timeline, no reporting case, gap ≠ 0) |

Existing tests changed: none.
