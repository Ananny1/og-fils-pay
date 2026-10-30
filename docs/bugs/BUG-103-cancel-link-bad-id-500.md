# BUG-103 — Cancelling a payment link with a non-UUID id returns 500

| | |
|---|---|
| **Severity** | Low |
| **Area** | API robustness |
| **Commit** | see `git log --grep "BUG-103"` |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/paymentLinks/cancel.ts:16` (`WHERE id = $1` on a uuid column) with no id check in `apps/api/src/routes/paymentLinks.ts` cancel route, at 8b58b0f.

## 1. The issue — what was wrong

`DELETE /v1/merchants/:merchantId/payment-links/not-a-uuid` (a typo, a token
pasted instead of an id) answered `500 internal_error`. It should be the same
`404 payment_link_not_found` as any id that names no link.

## 2. Why it happened — the root cause

The route passes `request.params.id` straight to `cancelPaymentLink`, whose
query is `UPDATE payment_links ... WHERE id = $1 ...`. `id` is a `uuid`
column, so Postgres throws `invalid input syntax for type uuid` (22P02), which
the error handler maps to 500.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants (API integrations) | 500 instead of 404 → retries / alerts on their side | Low |
| FilsPay ops | Noise 500s | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/paymentLinks.ts` cancel route | if the id is not UUID-shaped (`UUID_RE`, already used by `adminCredits.ts` for the same reason) → `404 payment_link_not_found` before any query |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | `UUID_RE` check in the route → 404 | Same pattern as `adminCredits.ts`, no DB trip | — | ✅ |
| 2 | Map pg 22P02 to 400 in the error handler | Global | Could hide real bugs as client errors | |
| 3 | Route params schema with `format: uuid` | Declarative | Returns 400 not 404; bigger change | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-103: cancelling a link id that is not a UUID is a 404, not a 500` | `apps/api/src/routes/paymentLinksList.new.test.ts` | ❌ `{"error":"internal_error"}` (log: `invalid input syntax for type uuid`) | ✅ 404 `payment_link_not_found` |

```bash
DATABASE_URL=... npx tsx --test src/routes/paymentLinksList.new.test.ts src/routes/paymentLinks.test.ts src/routes/paymentLinks.new.test.ts   # 13/13
```

Existing tests changed: none.
