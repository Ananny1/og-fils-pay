# BUG-034 — Two refunds at the same moment both succeed

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Money · Refunds (FP-300) · Concurrency |
| **Analysis ID** | R1 |
| **Clue** | S4 ticket FP-209 (double refund); test-file note "should there be a test for two refunds at the SAME time? nvm the claim blocks it" |
| **Owner** | Stream S6 |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** Two refunds sent at the same time on one 10.000 BD sale (6.000 BD each, different idempotency keys, e.g. a double-click in the drawer) both succeed. 12.000 BD goes back to the card, but FilsPay records only 6.000 BD refunded.
- **Why:** `processRefund` checked the refundable amount in **transaction 1** (no row lock), called the acquirer **outside** any transaction, then wrote the result in **transaction 2** without checking again. Both requests read `refunded_fils = 0`, both pass, both write `0 + 6000` (lost update).
- **What it breaks:** Double money out to the cardholder, ledger and `refunded_fils` disagree with what the acquirer paid, and the shop's next payout is wrong.

## 1. The issue

Test (before fix): two parallel `processRefund` calls of 6 000 fils on a 10 000 capture, slow acquirer (150 ms):
both answer **200**, two `refunds` rows (12 000 fils), `transactions.refunded_fils = 6000`.

## 2. Why it happened

```ts
// apps/api/src/payments/processRefund.ts (before)
const prepared = await withTransaction(pool, ... SELECT ... FROM transactions WHERE id = $1 ...);   // tx 1, no lock
const acquirerResult = await acquirer.refund(...);                                                  // no tx
return withTransaction(pool, ... newRefundedTotal = prepared.refundedFils + amount ...);          // tx 2, stale value
```

False claims that hid it:
- `processRefund.test.ts`: "nvm the claim blocks it". The idempotency claim only blocks the **same key**; two clicks get two keys.
- `idempotency.ts`: "sweeper already exists in scripts/sweep_idempotency.ts". No such file exists. Reported for `TRAPS.md`; comment corrected.

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/payments/processRefund.ts` | one `withTransaction` from claim to journal; the transaction row is read `FOR UPDATE` and the lock is held through the acquirer call (same design as `capture.ts`, "held across the call on purpose") |
| `apps/api/src/payments/idempotency.ts` | comment no longer claims refunds commit the claim early or that a sweeper exists |
| `apps/api/src/payments/processRefund.test.ts` | new test: two parallel 6 000 refunds on 10 000 → one 200, one 422; `refunded_fils` and the sum of refund rows are 6 000 |

The validation, acquirer and journal code are unchanged, only wrapped in the one transaction (re-indented).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | One transaction + `SELECT … FOR UPDATE` held through the acquirer call (as `capture.ts`) | Correct by construction; matches the existing capture design; small change | Row lock held for the acquirer latency (only blocks other writes to **that one** sale) | ✅ |
| 2 | Keep two transactions, but in tx 1 lock and **reserve** (bump `refunded_fils`), release on decline/error | Lock not held over the network | More states to undo; a crash between steps leaves a reservation that needs a sweeper | |
| 3 | Re-check in tx 2 with `FOR UPDATE` | Tiny change | Too late: the acquirer has already paid the second refund | |
| 4 (creative) | Atomic SQL `UPDATE transactions SET refunded_fils = refunded_fils + $2 WHERE … AND refunded_fils + $2 <= captured_fils RETURNING …` as the reservation | No explicit lock; one statement | Same release/crash issues as #2 | |

## 6. Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| `two refunds at the same moment cannot together exceed the captured amount` | `apps/api/src/payments/processRefund.test.ts` | ❌ codes `[200, 200]` | ✅ `[200, 422]`, totals 6 000 |
| same test, single transaction but **without** `FOR UPDATE` | same | ❌ still `[200, 200]` (the lock is what fixes it) | — |
| other 12 refund tests | same file | ✅ | ✅ |

Existing tests changed: none (one test added).
