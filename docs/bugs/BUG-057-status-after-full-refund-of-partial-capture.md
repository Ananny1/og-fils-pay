# BUG-057 — a fully refunded partial capture still showed "partially captured"

| | |
|---|---|
| **Severity** | High · ★ |
| **Area** | Refunds (FP-300) · transaction status |
| **Analysis ID** | R5 |
| **Clue** | `refundState.ts` "FH: Huda's rule … 'a transaction is refunded when every fils we captured went back'. this function doesn't follow that for partial captures" |
| **Owner** | Stream S6 |
| **Status** | ✅ fixed |

## 1. The issue

Authorize 10.000 BD, capture 4.000 BD, refund all 4.000 BD. The transaction kept the status
`partially_captured`. The dashboard showed it as an open sale with a Capture button, the CSV export and the
status filter put it with live sales, and the merchant could capture more on a sale they had fully refunded.

## 2. Why it happened

`nextStatusAfterRefund` returned `partially_captured` **first** whenever `captured < authorized`, before it
looked at the refunded amount. So the "everything went back → `refunded`" rule never ran for a partial capture.

**Trap:** the comment "FH 21/07/2026: Huda confirmed finance wants headroom kept open here, so
partially_captured is the right answer even after a full refund" contradicts Huda's own written rule quoted
two lines above it ("refunded when every fils we captured went back"). Treated as a claim and checked: the
rule in the code's header (`"refunded" means refunded_fils === captured_fils`) and ANALYSIS R5 agree with
Huda's rule, not with the comment. (For the team: add to `TRAPS.md`.)

## 3. Who was affected

Every merchant who captured part of an order and then refunded all of it: wrong status on the transaction
page, list filters and exports; an extra capture was still allowed.

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/payments/refundState.ts` | check "refunded total > 0 and ≥ captured → `refunded`" **before** the partial-capture rule; the false comment thread replaced by one accurate line |
| `apps/api/src/payments/refundState.test.ts` | 2 new tests |
| `apps/api/src/payments/processRefund.test.ts` | one assertion updated (see below) |

A **partial** refund of a partial capture still keeps `partially_captured` (headroom stays capturable) —
unchanged. `admin/transactionStatusRecompute.ts` uses the same function, so a recompute now also gives
`refunded` for such rows.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Full-refund check first, rest unchanged | 1 small change; follows the written rule; one place | Unused headroom can no longer be captured after a full refund (that is the point: the sale is over) | ✅ |
| 2 | `partially_refunded` for any refund of a partial capture | Simple | Blocks capturing remaining headroom after a small refund | |
| 3 | Keep status, add a separate "fully refunded" flag | No status change | Two sources of truth; filters and exports still wrong | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| `a full refund of a partially captured transaction is refunded` | `refundState.test.ts` | ❌ `partially_captured` | ✅ |
| `a partial refund of a partially captured transaction keeps its capture status` | same | ✅ | ✅ |
| `a refund can never exceed what was captured` | `processRefund.test.ts` | ✅ | ✅ (updated) |
| refund route / processRefund / admin tests | — | ✅ | ✅ |

**Existing test changed (justified):** `processRefund.test.ts` "a refund can never exceed what was captured"
expected a 422 for one more fil after refunding the whole 4.000 BD of a partial capture. That 422 came from
the bug: the row was still `partially_captured`, so it reached the amount check. Now the row is `refunded`
and the API answers 409 `transaction_not_refundable`, the same as for any fully refunded sale. The money
assertion (refunded total stays 4000 fils) is unchanged, and the test now also checks the status is `refunded`.
