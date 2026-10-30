# FP-300.5 (timeline) — a refund shows in the transaction's detail and history

| | |
|---|---|
| **Severity** | Feature (missing) · ★ |
| **Area** | Refunds (FP-300) · Transactions API |
| **Analysis ID** | §4 checklist item 7 |
| **Clue** | `serialize.ts` "TODO(am): add refundedFils once 0043 is applied everywhere"; web `types.ts` "no refundedFils on this DTO, so the drawer can't compute what's still refundable" |
| **Owner** | Stream S6 |
| **Status** | ✅ done |

## Summary (the short note)

- **What was missing:** `processRefund` already wrote a `refund_partial` / `refunded` row to `transaction_events`
  (negative amount in fils), so `GET /v1/transactions/:id/events` did list it. But the event did not say what
  status the transaction had after it, and `GET /v1/transactions/:id` had no `refundedFils` at all — the detail
  page (and the Refund drawer) could not tell how much was already refunded or what is still refundable.
- **Why:** `serializeTransaction` never mapped the `refunded_fils` column added in 0043 (the TODO above;
  0043 has long been applied everywhere — every query is `SELECT *` / `RETURNING *`).
- **Who was affected:** merchants looking at a refunded payment: "Captured 10.000 BD" with no sign that it had
  all gone back, except the status badge.

## 4. The change

| File | Change |
|---|---|
| `apps/api/src/transactions/serialize.ts` | `refundedFils` added to the public transaction shape (from `refunded_fils`, `0` if a row has no such column); stale TODO removed |
| `apps/api/src/payments/processRefund.ts` | the refund's timeline event metadata now also carries `transactionStatus` (the status after this refund) |
| `apps/api/src/routes/refunds.test.ts` | new test (below) |

Additive only: no field removed or renamed, so existing clients keep working.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Add `refundedFils` to the DTO + status in the event metadata | Two small additive changes; the timeline row reads on its own | — | ✅ |
| 2 | Web page computes refunded from the sum of negative events | No API change | Second copy of the money rule in the browser; drifts | |
| 3 | New `GET /refunds?transactionId=` list for the page | Full refund detail | New route + query for what one column already holds | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| `FP-300.5: the transaction detail and timeline show the refund (amount in fils, status after it)` — 10.000 BD captured, refund 2.500 then the rest; detail shows `refundedFils 10000`, status `refunded`; events show `refund_partial −2500 → partially_refunded`, `refunded −7500 → refunded`; all events sum to 0 fils | `apps/api/src/routes/refunds.test.ts` | ❌ `refundedFils` undefined | ✅ |
| other refund / transaction / capture tests | `refunds.test.ts`, `transactions.test.ts`, `processRefund.test.ts`, `capture.new.test.ts` | ✅ | ✅ (35/35) |

Existing tests changed: none.
