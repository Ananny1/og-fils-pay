# BUG-056 — Fee reversal across partial refunds can exceed the original fee

| | |
|---|---|
| **Severity** | High |
| **Area** | Money · Fees · Refunds (FP-300) |
| **Analysis ID** | R4 |
| **Clue** | S2 FP-300 sheet: "fee reversal proportional and never above the original" |
| **Owner** | Stream S6 |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** When a sale is refunded in several parts, the fee given back to the shop can add up to **more than the fee it paid**. Example: fee 2 fils on a 3-fil sale, refunded 1 fil at a time → 1 + 1 + 1 = 3 fils of fee given back.
- **Why:** Each partial refund rounded its own share (`round(fee × part / captured)`) on its own. Rounding errors pile up instead of cancelling.
- **What it breaks:** FilsPay pays out fee it never earned, and `platform_fee_revenue` for the sale ends below zero, so the ledger and fee reports never tie out. Small per refund, but systematic across many partial refunds (e-commerce returns).

## 1. The issue

Test (before): merchant MDR 6667 bps, capture 3 fils (fee 2), three refunds of 1 fil → reversed fee `[1, 1, 1]`, total 3 > 2.

## 2. Why it happened

```ts
// apps/api/src/payments/processRefund.ts (before)
const feeReversedFils = calculateRefundFee(capturedFils, feeChargedFils, requestedAmount);   // this part only
```

`calculateRefundFee` itself is correct for one proportion; the caller applied it per partial with no memory of what
earlier refunds already reversed.

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/payments/processRefund.ts` | reversal = `calculateRefundFee(captured, fee, refundedTotalAfterThis)` − `SUM(refunds.fee_reversed_fils)` already reversed (never below 0), read inside the locked transaction |
| `apps/api/src/payments/processRefund.test.ts` | new test: fee 2 on 3 fils, three 1-fil refunds → running total never above 2, final total exactly 2, every ledger account nets to 0 |

Because the refunded total can never exceed captured (BUG-035), the cumulative share can never exceed the fee, and at a
full refund it equals the fee exactly. `packages/money` is unchanged.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Cumulative share minus already reversed (from `refunds`) | Exact to the fil; telescopes to the full fee; also corrects older rows if any | One extra small query per refund | ✅ |
| 2 | Cumulative share minus `calculateRefundFee(previous total)` (no DB read) | No query | Assumes every earlier refund used the same formula | |
| 3 | Always round partial shares down, give the remainder on the last refund | Never over | The "last" refund may never come; shops lose up to 1 fil per part meanwhile | |
| 4 (creative) | Change `calculateRefundFee` in `packages/money` to take `(captured, fee, refundedBefore, refundAmount)` | The rule lives in the money library with its own unit tests | Signature change touches the shared package other streams edit; can follow later | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| `partial refunds never reverse more fee in total than was charged` | `apps/api/src/payments/processRefund.test.ts` | ❌ "after refund 3 reversed 3 > fee 2" | ✅ |
| all other refund + route tests (21) | `processRefund.test.ts`, `routes/refunds.test.ts` | ✅ | ✅ |

Existing tests changed: none.
