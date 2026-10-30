# BUG-035 — A shop can refund more than it captured

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Money · Refunds (FP-300) |
| **Analysis ID** | R2 |
| **Clue** | S4 support ticket "refund more than charged" |
| **Owner** | Stream S6 |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** A sale authorized for 10.000 BD but captured for only 4.000 BD could be refunded 10.000 BD. 6.000 BD that the customer never paid goes back to the card.
- **Why:** The refund ceiling was computed from the **authorized** amount (`amount_fils - refunded_fils`), not from what was **captured** (`captured_fils - refunded_fils`).
- **What it breaks:** Every partial capture (hotel deposits, split shipments, discounts at capture) becomes a way to pull extra money out. FilsPay pays the acquirer the difference and the shop's payable goes negative.

## 1. The issue

Test (before fix): authorize 10 000 fils, capture 4 000, refund 10 000 → **200**, `refunded_fils = 10 000`.

## 2. Why it happened

```ts
// apps/api/src/payments/processRefund.ts (before)
const refundableFils = subtractFils(amountAuthorized, refundedFils);
```

`validateRefundRequest` trusts the `refundableFils` it is handed, so its own unit tests passed: the bug was in the caller.
The drawer comment "max refund = captured is right" and the `refundState.ts` note "refundValidation stops the second
refund since refunded == captured" both assumed this line was right; they were only true for full captures.

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/payments/processRefund.ts` | `refundableFils = captured_fils - refunded_fils` |
| `apps/api/src/payments/processRefund.test.ts` | new test: auth 10 000 / capture 4 000 → refund 10 000 is 422 with `refundableFils: 4000`; blank amount refunds 4 000; one more fil is 422 |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Compute the ceiling from `captured_fils` in `processRefund` | One line, at the root cause; validator unchanged | — | ✅ |
| 2 | Make `validateRefundRequest` compute the ceiling itself from `capturedFils` and a `refundedFils` input | Rule in one tested place | Changes the validator's interface and its 10 tests | |
| 3 | DB CHECK `refunded_fils <= captured_fils` on `transactions` | Last-line guard for every writer | Fires after the acquirer already paid out; must be paired with option 1 anyway | |
| 4 (creative) | Ask the acquirer for the captured amount before each refund | Independent second source | Extra network call per refund; simulator has no such endpoint | |

## 6. Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| `a refund can never exceed what was captured` | `apps/api/src/payments/processRefund.test.ts` | ❌ expected 422, actual 200 | ✅ passes |
| other 11 refund tests | same file | ✅ | ✅ |

Existing tests changed: none (one test added).
