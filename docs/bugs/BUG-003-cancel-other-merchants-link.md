# BUG-003 — Merchant A can cancel merchant B's payment link

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Security |
| **Analysis ID** | A6 |
| **Clue** | Handout: "I cancelled merchant B's link from A's dashboard"; MK's comment above `assertOwnMerchant` |
| **Decision** | — |
| **Commit** | see `git log --grep "BUG-003"` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

Any merchant (owner/finance session, or any API key) could cancel any other
merchant's active payment link. They only needed the link id, which appears
in the merchant's own dashboard URLs, webhooks and support tickets.

Reproduce: as merchant A, call
`DELETE /v1/merchants/<A's id>/payment-links/<B's link id>` → 204, and B's
link is now `canceled`. B's customers can no longer pay.

## 2. Why it happened — the root cause

The route `apps/api/src/routes/paymentLinks.ts` only checked that the
**path** merchant id equals the caller (`assertOwnMerchant`). It never checked
that the **link** belongs to that merchant. `apps/api/src/paymentLinks/cancel.ts`
then updated by id alone:

```ts
// before
UPDATE payment_links
   SET status = 'canceled', canceled_at = now()
 WHERE id = $1 AND status = 'active'
```

The comment "am: this is the ownership check for create/cancel/list.
cancel.ts relies on it" is false for cancel — MK even asks "it checks the
path merchant, not that the link belongs to that merchant?". Nobody fixed it.

Other payment-link reads were checked: the merchant list (`query.ts`) is
filtered by `merchant_id = $1` from the authenticated context, and the public
read by token (`read.ts`) is public by design. There is no merchant "link
detail" endpoint. Only cancel had the hole.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Cannot pay invoices that were silently cancelled | Medium |
| Merchants | A competitor or any merchant can cancel all their open links (lost sales) | High |
| FilsPay (finance / ops) | Tenant isolation broken; support load | High |
| Acquirer / card scheme / partners | — | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/paymentLinks/cancel.ts` | takes `merchantId`; both the UPDATE and the follow-up SELECT add `AND merchant_id = $2` |
| `apps/api/src/routes/paymentLinks.ts` cancel route | passes `request.merchantAuth!.merchantId` (the authenticated merchant, not the path) |

```ts
// after
WHERE id = $1 AND merchant_id = $2 AND status = 'active'
...
SELECT status FROM payment_links WHERE id = $1 AND merchant_id = $2
```

Another merchant's link is answered with 404 `payment_link_not_found`, the
same as a link that does not exist, so the endpoint does not reveal which ids
exist at other merchants.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Scope the query by the authenticated merchant id | Ownership is enforced in the same statement that writes; no race | — | ✅ |
| 2 | Load the link first, compare merchant in the route, then cancel | Readable | Two statements; easy to forget in the next route | |
| 3 | Return 403 for another merchant's link | Clear | Leaks that the id exists | |

**Why we chose #1:** the database row itself enforces ownership, the same way `listPaymentLinks` already does.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-003: merchant A cannot cancel merchant B's payment link ...` | `apps/api/src/routes/paymentLinks.new.test.ts` | ❌ 204, B's link cancelled | ✅ 404, B's link still active; B can cancel its own |

```bash
cd apps/api && npx tsx --test src/routes/paymentLinks.new.test.ts src/routes/paymentLinks.test.ts
```

Existing tests changed: none.
