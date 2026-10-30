# BUG-036 — A shop can refund another shop's transaction

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Security (authorization) · Money · Refunds (FP-300) |
| **Analysis ID** | R3 |
| **Clue** | `processRefund.test.ts` TODO: "another merchant's transaction answers 404 — Claude says it's covered by the route test already" (false: the route was a 501 stub, no such test existed) |
| **Owner** | Stream S6 |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** If shop B sends the id of shop A's sale to the refund code, the refund goes through. Money leaves shop A's balance.
- **Why:** Both refund helpers look the transaction up **by id only** (`WHERE id = $1`). `initiateMerchantRefund` then even swaps the caller's merchant id for the **owner's** id from the database, so every later step acts "as shop A".
- **What it breaks:** Anyone with a merchant login or API key and a leaked/guessed transaction id can drain another shop's payout by refunding its sales (to a card the attacker controls if they made the sale look like theirs), and the refund is recorded as shop A's.

## 1. The issue

Test (before fix): merchant A captures 6.000 BD; `processRefund(..., merchantId: B, transactionId: A's)` answers **200** and
`refunds` gets a row on A's transaction.

## 2. Why it happened

```ts
// apps/api/src/payments/processRefund.ts (before)
SELECT ... FROM transactions WHERE id = $1                -- input.merchantId never checked

// apps/api/src/refunds/initiateMerchantRefund.ts (before)
SELECT id, merchant_id FROM transactions WHERE id = $1
return processRefund(pool, acquirer, { merchantId: txn.merchant_id, ... })   // caller's id replaced by owner's
```

Trap: the test-file TODO says "Claude says it's covered by the route test already". There was no route
(501 stub) and no such test. Reported for `TRAPS.md`.

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/payments/processRefund.ts` | lookup is `WHERE id = $1 AND merchant_id = $2` (the caller); another shop's sale → 404 `transaction_not_found` |
| `apps/api/src/refunds/initiateMerchantRefund.ts` | same scoping in its lookup, so it can no longer pick up a foreign `merchant_id` |
| `apps/api/src/payments/processRefund.test.ts` | new test: cross-merchant refund through both helpers → 404, no refund row, transaction untouched |

404 (not 403) so the answer does not reveal that the id exists, same as `GET /v1/transactions/:id`.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Scope the lookup by the caller's merchant id in **both** helpers | Two one-line SQL changes; defence in depth (the inner helper is safe even if called directly); does not leak existence | — | ✅ |
| 2 | Only fix `initiateMerchantRefund` (compare `txn.merchant_id` to caller) | Smallest | `processRefund` stays unsafe for any other caller (admin tools, scripts) | |
| 3 | Return 403 when the owner differs | Clear message | Confirms to an attacker that the id is real | |
| 4 (creative) | Postgres row-level security on `transactions` keyed by a per-request `app.merchant_id` setting | Protects every query, not just refunds | Large change across the whole API; not doable in the sprint | |

## 6. Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| `refunding another merchant's transaction answers 404 and moves no money` | `apps/api/src/payments/processRefund.test.ts` | ❌ expected 404, actual 200 | ✅ passes |
| other 10 refund tests | same file | ✅ | ✅ |

Existing tests changed: none (one test added).
