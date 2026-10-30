# BUG-004 — Expired payment link still payable (client `submittedAt`)

| | |
|---|---|
| **Severity** | High (P1) |
| **Area** | Security · Money (payment links) |
| **Analysis ID** | P1-C "Expired link still payable (FP-187)" in `docs/challenge/ANALYSIS.md` |
| **Clue** | FP-187; route comment "ignored unless the request is authenticated with an API key" |
| **Decision** | D-016 (4-hour sprint, stream S2) |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** A payment link that has expired can still be paid. The buyer only has to send an old time in the request.
- **Why:** The public pay route takes `submittedAt` from the request body and the server checks expiry against **that** time, not its own clock.
- **What it breaks:** A shop sets an expiry (for a price, a promo, stock it no longer has) and it means nothing. Anyone can pay a dead invoice at the old price, at any time.

## 1. The issue

Reproduce: create a link, let it expire (or set `expires_at` in the past), then

```
POST /v1/payment-links/<token>/pay   { "card": {...}, "submittedAt": "<yesterday>" }
→ 200 { "status": "paid" }     (expected 410 payment_link_expired)
```

Without `submittedAt` the same request correctly answers 410.

## 2. Why it happened

`apps/api/src/routes/paymentLinks.ts` (pay route) passed the body value straight through:

```ts
const { card, submittedAt } = request.body ?? {};
... payPaymentLink(..., { token, card, idempotencyKey, submittedAt });
```

and `apps/api/src/paymentLinks/pay.ts` `expiryReferenceTime(submittedAt)` uses it in the claim
`... AND expires_at > $3`. The route is **public** (no API key, no session).

**False claim (trap):** the route's doc comment said `submittedAt` is "ignored unless the request
is authenticated with an API key". There is no such check: the public route has no API key at all
and passed it every time. The test file also carried a note "with a past submittedAt it pays —
that's the terminal case", which presented the bug as expected behaviour.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Can pay an invoice the shop meant to close | Low (they get what they pay for) |
| Merchants | Expired prices/offers still charged; money arrives for orders they cancelled by letting the link expire | High |
| FilsPay (finance / ops) | Refund and dispute work for payments that should never happen | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/paymentLinks.ts` | Pay route no longer reads or forwards `submittedAt`; expiry is judged by the server clock. Doc comment corrected. |
| `apps/web/src/pages/checkout/CheckoutPage.tsx` | Checkout stops sending `submittedAt` (plan item F2). |
| `apps/web/src/api/paymentLinks.ts` | `submittedAt` removed from the client input type. |
| `apps/api/src/routes/paymentLinks.test.ts` | New test; removed the misleading note above the expired-link test. |

```ts
const { card } = request.body ?? {};
// No submittedAt: a client-chosen time must never decide expiry (BUG-004).
{ token: request.params.token, card, idempotencyKey },
```

Smallest correct change: the one place that let untrusted input reach the expiry check is closed.
Old clients that still send the field keep working (it is just ignored). `expiryReferenceTime`
already falls back to the server clock when no value is given, so `pay.ts` is unchanged.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Route ignores `submittedAt`; checkout stops sending it | Tiny, removes the root cause, old clients still work | Field and helper stay in `pay.ts` for a future authenticated caller | ✅ |
| 2 | Remove `submittedAt` from `pay.ts` and use DB `now()` in SQL | Also removes app/DB clock drift | Bigger diff, rewrites the helper and its unit tests | |
| 3 | Accept `submittedAt` but only within a small grace window (e.g. 30 s) of server time | Keeps the "pressed pay just before expiry" case | Still trusts the client a little; more code to get right | |
| 4 (creative) | Server issues a signed "pay intent" (token + server time, HMAC) when the checkout page loads; pay checks the signature and a short window | Fair to slow buyers and tamper-proof | Needs a new endpoint, key and frontend flow; too big for the sprint | |

**Why we chose #1:** it closes the hole completely with a few lines and no behaviour change for honest buyers.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `expired link: a past submittedAt in the body is ignored — pay still rejected 410` | `apps/api/src/routes/paymentLinks.test.ts` | ❌ fails (expected 410, actual 200) | ✅ passes |
| rest of payment-link route + `pay.test.ts` (13 tests) | same files | ✅ | ✅ |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -T -e DATABASE_URL=... api \
  npx tsx --test apps/api/src/routes/paymentLinks.test.ts apps/api/src/paymentLinks/pay.test.ts
```

`tsc --noEmit -p apps/api` clean. Existing tests changed: only the misleading comment above the
expired-link test was removed.
