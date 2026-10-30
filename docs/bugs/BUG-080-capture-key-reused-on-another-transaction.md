# BUG-080 — A capture Idempotency-Key reused on another transaction says "captured" but captures nothing

| | |
|---|---|
| **Severity** | High |
| **Area** | Money |
| **Analysis ID** | — (bug hunt, merchant money paths) |
| **Clue** | Code review of `payments/capture.ts` vs `processRefund.ts` |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-080` |
| **Owner** | Sayed |
| **Evidence** | — |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/payments/capture.ts:92` at 8b58b0f.

## Summary (the short note)

- **What's wrong:** If a merchant captures sale B with an Idempotency-Key it already used for sale A, the API answers `200` with sale A's data. Sale B is never captured.
- **Why:** The capture request hash only covers `amountFils`; the transaction id from the URL is not part of it.
- **What it breaks:** The merchant believes B was paid and ships the goods; B's hold expires after 7 days and the money is never collected.

## 1. The issue — what was wrong

1. Authorize two sales, A and B.
2. `POST /v1/transactions/A/capture` with `Idempotency-Key: K` → `200`, A captured.
3. `POST /v1/transactions/B/capture` with the same `Idempotency-Key: K` (a client that reuses one key per order, or a bug in the merchant's retry code) → `200` with **A's** body. B is still `authorized`.

The rule for idempotency keys is: same key + different request → `422 idempotency_key_reused`. Refunds and authorize follow it; capture did not.

## 2. Why it happened — the root cause

`apps/api/src/payments/capture.ts:74` (before):

```ts
const requestHash = hashRequest({ amountFils: input.amountFils ?? null });
```

The key scope is `(merchant_id, endpoint, key)` and the transaction id lives in the URL, not the body. So two captures with the same key and the same (or omitted) amount hash the same, and `claimIdempotencyKey` returns `replay` with A's stored response. `processRefund.ts` already puts `transactionId` into its hash; capture never did.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Card held for a sale that is never collected | Low |
| Merchants | Told "captured" for a sale that was not; money never arrives | High |
| FilsPay (finance / ops) | Lost MDR fee; confusing support cases ("API said 200") | Medium |
| Acquirer / card scheme | Authorization expires uncaptured | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/payments/capture.ts:74` | `transactionId` added to the request hash |

```ts
const requestHash = hashRequest({ transactionId: input.transactionId, amountFils: input.amountFils ?? null });
```

One line, same pattern as `processRefund.ts`. A real retry (same key, same transaction, same amount) still replays; the same key on another transaction now gets `422 idempotency_key_reused`. Payment-link checkout keys already contain the link id, so they are unaffected.

Note: a retry of a capture made *before* this deploy, with the same key, would now hash differently and get `422`. That window is the retry window of in-flight requests only.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Put `transactionId` in the capture hash | One line; same as refunds; existing 422 path handles it | Pre-deploy in-flight retries get 422 | ✅ |
| 2 | Compare `row.resourceId` with the URL id on replay | No hash change | Second rule to keep in sync; failed/404 claims have no resourceId | |
| 3 | Make the idempotency scope `capture:<txnId>` | Keys per transaction | Same key on two sales would silently both run, hiding client bugs | |

**Why we chose #1:** smallest change, matches the existing convention in `processRefund.ts`.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-080: the same capture Idempotency-Key on a second transaction is rejected, not replayed` | `apps/api/src/payments/captureIdempotencyScope.new.test.ts` | ❌ fails (200 replay of A, "Missing expected rejection") | ✅ passes |

```bash
cd apps/api && npx tsx --test src/payments/captureIdempotencyScope.new.test.ts
```

Existing tests changed: none.
