# BUG-101 — Payment-link list returns 500 for a non-numeric `?limit=`

| | |
|---|---|
| **Severity** | Low |
| **Area** | API robustness |
| **Commit** | see `git log --grep "BUG-101"` |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/routes/paymentLinks.ts:126` and `apps/api/src/paymentLinks/query.ts:66` at 8b58b0f.

## 1. The issue — what was wrong

`GET /v1/merchants/:id/payment-links?limit=abc` (or `limit=`, `limit=ten`)
answered `500 internal_error` and logged an "unhandled error". A merchant
integration with a typo got a server error instead of a page, and on-call saw
false 500 alarms.

## 2. Why it happened — the root cause

The route does `Number.parseInt(q.limit, 10)` → `NaN`. `query.ts:66`:

```ts
// before
const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
```

`??` only catches `undefined`, and `Math.max/min` return `NaN` when given
`NaN`, so `LIMIT 'NaN'` reaches Postgres → `22P02 invalid input syntax for type bigint`.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | API/dashboard call fails with 500 on a bad limit | Low |
| FilsPay ops | Noise 500s in logs/alerts | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/paymentLinks/query.ts` | a non-finite `limit` is treated as "not given" → default 25, then clamped as before |

```ts
// after
const requested = Number.isFinite(filters.limit) ? filters.limit! : DEFAULT_LIMIT;
const limit = Math.min(MAX_LIMIT, Math.max(1, requested));
```

Fixed in `query.ts` (not the route) so every caller of `listPaymentLinks` is safe.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Treat NaN as default in `listPaymentLinks` | One line, covers all callers, matches the existing "clamp, don't reject" style | Silently ignores typo | ✅ |
| 2 | 400 `invalid_limit` in the route | Explicit | Only that caller; differs from how 0/1000 are clamped | |
| 3 | Fastify querystring schema | Declarative | Larger change | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-101: a non-numeric ?limit= falls back to the default page instead of a 500` | `apps/api/src/routes/paymentLinksList.new.test.ts` | ❌ `500 {"error":"internal_error"}` (log: `invalid input syntax for type bigint: "NaN"`) | ✅ 200, 2 links |

```bash
DATABASE_URL=... npx tsx --test src/routes/paymentLinksList.new.test.ts src/routes/paymentLinks.test.ts src/routes/paymentLinks.new.test.ts   # 10/10
```

Existing tests changed: none.
