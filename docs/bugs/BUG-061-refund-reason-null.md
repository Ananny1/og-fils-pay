# BUG-061 — Every refund fails: insert sends NULL into `refunds.reason`

| | |
|---|---|
| **Severity** | High (no refund can be saved at all) |
| **Area** | Money · Refunds (FP-300) |
| **Analysis ID** | R8 |
| **Clue** | T1 test run: 11 refund tests red with `chk_refunds_reason_not_null` |
| **Owner** | Stream S6 |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** Every refund crashes when it is saved. The database says "reason must not be empty", and the code sends an empty (NULL) reason when the shop gives none.
- **Why:** Migration `0070` added a column default `'unspecified'` and a CHECK `reason IS NOT NULL`. The code writes `input.reason ?? null`. A column default only applies when the column is left out; an explicit `NULL` skips it and hits the CHECK.
- **What it breaks:** No refund can be made, ever, once 0070 is applied (and it is, on every fresh database). The acquirer has already been asked to refund by then, so the money goes back at the acquirer but FilsPay records nothing: no refund row, no ledger, no webhook.

## 1. The issue

Run `apps/api/src/payments/processRefund.test.ts` on a migrated DB: every refund path that reaches the insert (7 of 10 tests) fails with
`new row for relation "refunds" violates check constraint "chk_refunds_reason_not_null"`.

## 2. Why it happened

```ts
// apps/api/src/payments/processRefund.ts (before)
input.reason ?? null,
```

```sql
-- db/migrations/0070_refund_reason_default.sql
ALTER TABLE refunds ALTER COLUMN reason SET DEFAULT 'unspecified';
ALTER TABLE refunds ADD CONSTRAINT chk_refunds_reason_not_null CHECK (reason IS NOT NULL) NOT VALID;
```

The migration comment says the default will cover "omitting the column in future INSERTs", but the
code never omits it. `NOT VALID` only skips old rows; new rows are still checked.

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/payments/processRefund.ts` | send `input.reason?.trim() \|\| "unspecified"` (the 0070 default) instead of `null` |
| `apps/api/src/payments/processRefund.test.ts` | the full-refund test also asserts the stored reason is `'unspecified'` |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Code sends the same default value (`'unspecified'`) when no reason is given | One line, no migration, matches 0070's intent, blank text also handled | The default string lives in two places (SQL + TS) | ✅ |
| 2 | Build the INSERT without the `reason` column when it is missing so the DB default applies | Default stays only in SQL | Two SQL shapes for one insert; easy to break again | |
| 3 | New migration dropping the CHECK | Code unchanged | Throws away the data-quality rule finance asked for; NULL reasons come back | |
| 4 (creative) | Make `reason` required in the API (400 if missing) | Every refund has a real reason for support | Breaks the web drawer and API clients that send none; bigger than the bug | |

## 6. Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| all 10 `processRefund` tests | `apps/api/src/payments/processRefund.test.ts` | ❌ 7 fail on the CHECK (only decline, void and 404 pass: they never insert) | ✅ 10 pass |
| full refund stores reason `'unspecified'` | same file | ❌ insert fails | ✅ passes |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -T -e DATABASE_URL=.../filspay_s6 ... api npx tsx --test apps/api/src/payments/processRefund.test.ts
```

Existing tests changed: one extra assertion (reason) in the full-refund test.
