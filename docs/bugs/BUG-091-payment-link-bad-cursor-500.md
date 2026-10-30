# BUG-091 — Payment-link list returns 500 for a malformed cursor

| | |
|---|---|
| **Severity** | Low |
| **Area** | API robustness |
| **Commit** | see `git log --grep "BUG-091"` |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/paymentLinks/query.ts:24-39` (decodeCursor) and `:74` (`$3::timestamptz`) at 8b58b0f.

## 1. The issue — what was wrong

`GET /v1/merchants/:id/payment-links?cursor=<anything base64url with a "|">`
whose halves are not a timestamp and a UUID (a truncated/copied cursor, an old
client, a fuzzer) answered `500 internal_error`. The function's own doc says
"Any malformed cursor decodes to null, which restarts from the first page
instead of erroring" — that was not true.

Reproduce: `cursor=Z2FyYmFnZXx4` (= `garbage|x`) → 500, log
`invalid input syntax for type timestamp with time zone: "garbage"`.

## 2. Why it happened — the root cause

`decodeCursor` only checked that both halves were non-empty:

```ts
// before
if (!createdAt || !id) return null;
return { createdAt, id };
```

Then the SQL casts them: `($3::timestamptz IS NULL OR (created_at, id) < ($3, $4))`.
An unparseable timestamp or non-UUID id makes Postgres throw (22P02 / 22007).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Paging fails with 500 on a damaged cursor | Low |
| FilsPay ops | Noise 500s; cheap way to fill error logs | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/paymentLinks/query.ts` | `decodeCursor` also returns `null` unless the id matches `UUID_RE` (existing, from `admin/merchants.ts`) and the timestamp matches Postgres' timestamptz text form |

The promised behaviour (malformed → first page) now holds; valid cursors are
unchanged (second test pages 3 links with limit 2, each seen once).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Validate both halves in `decodeCursor` | Matches documented contract, no DB round-trip | Regex must match PG output | ✅ |
| 2 | Return 400 `invalid_cursor` | Explicit | Contradicts documented behaviour | |
| 3 | Catch the pg error in the route | Small | Hides real DB errors too | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-091: a malformed cursor restarts from the first page instead of a 500` | `apps/api/src/routes/paymentLinksList.new.test.ts` | ❌ `garbage|x: {"error":"internal_error"}` | ✅ 200, 2 links |
| `BUG-091: a real nextCursor still pages through every link exactly once` | same | ✅ (guard) | ✅ |

```bash
DATABASE_URL=... npx tsx --test src/routes/paymentLinksList.new.test.ts src/routes/paymentLinks.test.ts src/routes/paymentLinks.new.test.ts   # 12/12
```

Existing tests changed: none.
