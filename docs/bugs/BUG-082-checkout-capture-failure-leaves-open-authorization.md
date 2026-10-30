# BUG-082 — A failed capture at checkout leaves the payer's authorization open

| | |
|---|---|
| **Severity** | High |
| **Area** | Money (public checkout) |
| **Analysis ID** | — (bug hunt, merchant money paths) |
| **Clue** | `void.ts` says the checkout voids a payer's authorization; `pay.ts` never called it |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-082` |
| **Owner** | Sayed |
| **Evidence** | — |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/paymentLinks/pay.ts:128` at 8b58b0f.

## Summary (the short note)

- **What's wrong:** When paying a payment link, if the card is authorized but the capture is declined or the acquirer errors, the authorization is left open. The payer clicks "Pay" again and is charged by a second, new transaction.
- **Why:** `pay.ts` only gives the link back on a failed capture; it never voids the authorization it just made.
- **What it breaks:** The payer's card carries an extra hold for 7 days, and the merchant sees an "authorized" sale with a Capture button. Capturing it charges the payer twice for one link.

## 1. The issue — what was wrong

1. Buyer opens a payment link (4.750 BD) and pays. Authorize: approved. Capture: declined (or acquirer error — the simulator does this on 2% of calls by default).
2. Checkout answers 402/502 and the link is active again.
3. Buyer clicks "Pay" again. The web checkout sends a **new** Idempotency-Key per click, so this is a new authorization + capture → link paid.
4. Result: transactions `[authorized, captured]`. The first one keeps a 7-day hold on the card and can still be captured from the dashboard or API → second charge of 4.750 BD.

## 2. Why it happened — the root cause

`apps/api/src/paymentLinks/pay.ts:170` (before):

```ts
if (captureResult.statusCode !== 200) {
  await releaseReservation(client, link.id);
  return { statusCode: captureResult.statusCode, body: { stage: "capture", ... } };
}
```

The authorization (`transactions.status = 'authorized'`, `holds.status = 'active'`) created a few lines above is left as it is. `void.ts` documents a `'system'` actor for "the payment-link checkout voiding a payer's authorization", but nothing in `pay.ts` calls `voidTransaction`.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Extra 7-day hold; possible double charge if the merchant captures the orphan | High |
| Merchants | A "ghost" authorized sale per failed checkout; capturing it causes a chargeback | Medium |
| FilsPay (finance / ops) | Disputes and refunds for double charges | Medium |
| Acquirer / card scheme | Authorizations left open until they expire | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/paymentLinks/pay.ts` | On any non-200 capture, `voidTransaction(...)` the authorization (actor `system`, id = link id) before releasing the link |
| `apps/api/src/payments/void.ts` | `voidTransaction` accepts `Pool \| PoolClient` (like capture), so it runs on the checkout's locked connection |

```ts
if (captureResult.statusCode !== 200) {
  await voidTransaction(client, { transactionId: txnId, merchantId: link.merchantId, actor: { type: "system", id: link.id } });
  await releaseReservation(client, link.id);
  ...
```

`voidTransaction` only changes a row in `authorized` status, so it can never undo a real capture. It releases the hold and records a `voided` event + `transaction.voided` outbox event, exactly like a merchant void.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Void the authorization when the checkout capture fails | Reuses `voidTransaction`; no orphan ever exists; timeline shows why | A retry with the same key now gets 409 (the web sends a new key per click anyway) | ✅ |
| 2 | Reuse the open authorization on the next pay attempt | No second authorization | Needs link→transaction lookup and new state; a different card would be ignored | |
| 3 | Sweep job that voids old link authorizations | No checkout change | Hold and double-charge window stay open until the sweep runs | |

**Why we chose #1:** smallest change that closes the window at the moment it opens, using the existing void path.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-082: capture declined at checkout voids the authorization; ...` | `apps/api/src/paymentLinks/payCaptureFailure.new.test.ts` | ❌ statuses `['authorized','captured']` | ✅ `['voided','captured']`, no active hold |
| `BUG-082: capture error at checkout voids the authorization; ...` | same | ❌ same | ✅ |

```bash
cd apps/api && npx tsx --test src/paymentLinks/payCaptureFailure.new.test.ts
```

Existing tests changed: none.
