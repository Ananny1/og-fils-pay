# BUG-086 — Retrying a failed partial capture can capture twice

| | |
|---|---|
| **Severity** | High |
| **Area** | Money (merchant dashboard) |
| **Analysis ID** | — (found in the frontend bug hunt) |
| **Clue** | comment "A fresh Idempotency-Key per click, including a retry" |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-086` |
| **Owner** | Sayed |
| **Evidence** | unit test |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** if a partial capture's answer is lost (network drop, timeout, 5xx) and the merchant clicks "Capture" again, the same amount can be captured a second time.
- **Why:** the capture dialog made a brand-new Idempotency-Key on every click, so the server could not tell the retry from a new capture.
- **What it breaks:** the cardholder is charged twice for the same partial capture (up to the authorized amount).

## 1. The issue — what was wrong

Transaction detail → Capture → type `2.000` → the request reaches the server and the capture
commits, but the reply is lost (Wi-Fi drop, proxy 502/504). The dialog shows "Can't reach FilsPay"
and stays open. The merchant clicks Capture again. The server allows several partial captures
(`apps/api/src/payments/capture.ts:117`, status `partially_captured`), so a second 2.000 BD is
captured. The API's idempotency store would have replayed the first result, but only if the same
key is sent.

## 2. Why it happened — the root cause

Present in the original code: `apps/web/src/pages/transactions/TransactionDetailPage.tsx:77` at 8b58b0f (`crypto.randomUUID()` per click).

`apps/web/src/pages/transactions/TransactionDetailPage.tsx:193` (before):

```ts
// A fresh Idempotency-Key per click, including a retry after a decline —
await captureTransaction(id, input, crypto.randomUUID());
```

A new key per click is right after a *definitive* answer (a decline), and wrong after an
*unknown* outcome. The comment treats both the same.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | charged twice for one partial capture | High |
| Merchants | refund and chargeback work; customer complaints | High |
| FilsPay (finance / ops) | extra fees/refunds to unwind | Medium |
| Acquirer / card scheme / partners | duplicate capture to reverse | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/web/src/lib/retryKey.ts` | new pure helper: one key per attempt (`intent` = txn + amount); `settle()` after a definitive answer; `isDefinitiveAnswer` = HTTP status < 500 and not 409 |
| `apps/web/src/pages/transactions/TransactionDetailPage.tsx` | capture uses it: same key on retry after network error/5xx/409; new key after success, a decline or other 4xx, or when the amount changes |

```ts
const key = captureKeys.current.keyFor(`${id}:${input.amountFils ?? "rest"}`);
try {
  await captureTransaction(id, input, key);
  captureKeys.current.settle();
} catch (err) {
  if (isDefinitiveAnswer(err)) captureKeys.current.settle();
  throw err;
}
```

The intent includes the transaction id because the API scopes keys per merchant and endpoint,
not per transaction.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Keep the key until a definitive answer | uses the API's existing idempotency; small | — | ✅ |
| 2 | Refetch the transaction before retrying | shows the real state | race with a slow first request; more code | |
| 3 | Server: refuse a second identical partial capture within N minutes | protects every client | blocks legitimate equal partial captures | |

**Why we chose #1:** it is what the Idempotency-Key is for, and needs no API change.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| retry after a network failure reuses its key | `apps/web/src/lib/retryKey.test.ts` | ❌ new key per click | ✅ same key |
| only a non-5xx answer is definitive | same | ❌ | ✅ |
| definitive answer / other amount → new key | same | ✅ | ✅ |

```bash
npm test -w apps/web
```

Existing tests changed: none. Not fixed here (out of scope, owned elsewhere): the refund drawer
(`RefundDrawer.tsx:126`) uses the same fresh-key-per-click pattern.
