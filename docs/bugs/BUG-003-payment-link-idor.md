# BUG-003 — Shop A can cancel (and probe) shop B's payment link

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Security (authorization, IDOR) |
| **Analysis ID** | A6 |
| **Clue** | "I cancelled merchant B's link from A's dashboard"; MK's own comment on `assertOwnMerchant` |
| **Owner** | Ebrahim (sprint stream S1) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** Shop A can cancel any other shop's active payment link. It only needs the link id.
- **Why:** The cancel query looks the link up by `id` only. The route checks that A owns the merchant in the **URL**, not that the **link** belongs to that merchant.
- **What it breaks:** A rival (or a bad API key) can kill another shop's live payment links, so their customers can't pay. A can also learn the status of B's links (`409 status: paid` vs `404`).

## 1. The issue

```
DELETE /v1/merchants/<A>/payment-links/<B's link id>   (A's key)   -> 204, B's link is now 'canceled'
DELETE /v1/merchants/<A>/payment-links/<B's paid link> (A's key)   -> 409 "status: paid"  (leaks B's status)
```

## 2. Why it happened

`apps/api/src/paymentLinks/cancel.ts`:

```ts
UPDATE payment_links SET status = 'canceled', canceled_at = now()
 WHERE id = $1 AND status = 'active'          -- no merchant_id
...
SELECT status FROM payment_links WHERE id = $1 -- no merchant_id
```

`apps/api/src/routes/paymentLinks.ts` `assertOwnMerchant` only compares `request.params.merchantId`
with the caller's merchant. The comment above it was a false claim (trap):

> `// am: this is the ownership check for create/cancel/list. cancel.ts relies on it, link ids are UUIDs`

It does not check the link. UUIDs are not secret: they show up in list responses, logs, support tickets and webhooks.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers | Their pay link suddenly says "canceled" | Can't pay |
| Merchants | Any other shop can cancel their links and read link status | High: lost sales, info leak |
| FilsPay | Cross-tenant write; breaks the "a merchant only sees its own data" promise | Critical |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/paymentLinks/cancel.ts` | Takes `merchantId`; both queries add `AND merchant_id = $2` |
| `apps/api/src/routes/paymentLinks.ts` | Passes `request.params.merchantId`; false comment replaced |

A foreign link now behaves exactly like a missing one: `404 payment_link_not_found`. The check is in
the SQL, so it can't be skipped by a route that forgets it.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Add `merchant_id = $2` to both queries in `cancel.ts` | Smallest; matches `listPaymentLinks`; no status leak | none | ✅ |
| 2 | Pre-check ownership in the route with a `SELECT merchant_id` and 403 | Easy to read | Extra query; race between check and update; 403 vs 404 reveals the id exists | |
| 3 | Postgres row-level security keyed on `app.merchant_id` (creative) | Protects every query, also future ones | Big change to every connection and test; too large for a fix | |

**Why #1:** it fixes the root cause in one place with the same pattern the rest of the code uses.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-003: merchant A cannot cancel or probe merchant B's payment link` | `apps/api/src/routes/paymentLinks.test.ts` | ❌ `204 !== 404` (B's link canceled) | ✅ passes |
| All other payment-link tests (happy cancel, 404, 409) | same | ✅ | ✅ (9/9 in the file) |

```bash
npx tsx --test apps/api/src/routes/paymentLinks.test.ts
```

Existing tests changed: none.
