# BUG-084 — Capturing the rest of a sale after a partial refund shows it as plain "captured"

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Money (transaction status) |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/payments/capture.ts:198` at 8b58b0f.

## Summary

- **What's wrong:** Authorize 10.000 BD, capture 5.000, refund 1.000, capture the remaining 5.000 → status `captured`, although 1.000 BD went back.
- **Why:** capture sets status only from `captured_fils` vs `amount_fils`; it ignores `refunded_fils`.
- **What it breaks:** The dashboard, status filter and CSV show the sale as fully captured with no refund; the `transaction.captured` webhook says `newStatus: captured`. Finance reconciling by status misses the refund.

## Root cause

`apps/api/src/payments/capture.ts:205` (before; line 198 at 8b58b0f):

```ts
const newStatus = compareFils(newCapturedFils, amountAuthorized) === 0 ? "captured" : "partially_captured";
```

Refunds are allowed on `partially_captured` sales (`refundValidation.ts`), and capture is allowed again afterwards, so this line overwrites the refund state.

## Fix

`capture.ts`: also reads `refunded_fils`; a full capture of a sale with `refunded_fils > 0` becomes `partially_refunded` (the same rule as `refundState.ts`). Hold release and the event type use a separate `fullyCaptured` flag, so they behave as before.

## Options

| Rank | Option | Chosen? |
|---|---|---|
| 1 | Take `refunded_fils` into account in capture's status line | ✅ |
| 2 | Block capture after any refund | Changes product behaviour; merchants lose the rest of the sale |
| 3 | Derive status in queries instead of storing it | Large refactor |

## Proof

| Test | Before | After |
|---|---|---|
| `apps/api/src/payments/captureAfterRefund.new.test.ts` | ❌ status `captured` | ✅ `partially_refunded`, hold released, last event `captured` |

Existing tests changed: none.
