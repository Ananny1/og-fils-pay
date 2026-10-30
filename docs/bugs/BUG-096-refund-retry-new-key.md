# BUG-096 — Retrying a refund after a lost answer refunds twice

| | |
|---|---|
| **Severity** | High (money: the customer is refunded twice, the shop pays twice) |
| **Area** | Refunds (FP-300) · Merchant dashboard |
| **Status** | ✅ fixed |

## Summary
- **What a user sees:** the shop clicks *Refund 20.000*. The refund goes through, but the phone's
  connection drops before the answer arrives, so the drawer shows an error. The owner clicks *Refund*
  again: a second 20.000 is refunded.
- **Why:** `apps/web/src/pages/transactions/RefundDrawer.tsx` sent
  `headers: { "Idempotency-Key": crypto.randomUUID() }` on every attempt ("a fresh key per attempt,
  including a retry"). The server de-duplicates by key (`initiateMerchantRefund.test.ts:208`), so a new
  key turns a retry into a new refund.
- **Fix:** one key per intended refund, kept in a ref. It is kept when no answer came back (fetch
  rejected), and replaced only after the server answered (success or a decline) or when the amount changes.


**Present in the original code (8b58b0f):** `apps/web/src/pages/transactions/RefundDrawer.tsx:69` `headers: { "Idempotency-Key": crypto.randomUUID() }` (its own comment at line 4: "it makes a new idempotency key per click").

## Who is affected
Any shop refunding on a flaky connection (mobile). Each retry can move another refund, up to what is
still refundable.

## Options considered
| Rank | Option | Chosen? |
|---|---|---|
| 1 | Keep the key until the server answers; new key on a new amount | ✅ |
| 2 | Key derived from (transaction, amount) | Blocks two genuine refunds of the same amount |
| 3 | Disable retry until a page reload | Hides the problem, bad UX |

## Proof
| Test | Before | After |
|---|---|---|
| `refundIdempotency.test.ts`: lost answer → same key; answered → fresh key | key regenerated on every attempt | ✅ 2 |
| Server side (existing) `initiateMerchantRefund.test.ts` "replaying an idempotency key returns the same body and writes one refund" | ✅ | ✅ |
