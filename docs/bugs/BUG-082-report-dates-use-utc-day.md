# BUG-082 — Transaction report date filter uses the UTC day, not the Bahrain day

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Reporting |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/reporting/transactionsReportQuery.ts:49` and `:53` (raw `from`/`to` pushed into `occurred_at >= / <`) at 8b58b0f.

## Summary

- **What's wrong:** `GET /v1/reporting/transactions?filter={"from":"2026-06-02","to":"2026-06-03"}` returns the UTC day, so payments made 00:00–03:00 Bahrain are missing from their day, and 00:00–03:00 of the next Bahrain day are wrongly included.
- **Why:** `runTransactionsReport` passes the date strings straight to Postgres; a bare date is read as midnight in the DB session timezone (UTC), not Asia/Bahrain.
- **What it breaks:** daily reports don't match the settlement batch for the same day (settlement day = midnight Bahrain = 21:00 UTC).

## Root cause

`apps/api/src/reporting/transactionsReportQuery.ts`:

```ts
params.push(filter.from);
conditions.push(`occurred_at >= $${params.length}`);
```

## Fix

`bahrainDayBoundary()` turns a plain `YYYY-MM-DD` into `YYYY-MM-DDT00:00:00+03:00`; full ISO
timestamps (with their own offset) are unchanged, so existing callers keep working.

## Options

| Rank | Option | Chosen? |
|---|---|---|
| 1 | Map date-only values to Bahrain midnight in the query builder | ✅ |
| 2 | `SET TIME ZONE 'Asia/Bahrain'` on the pool | affects every query in the API |
| 3 | Reject date-only values (require full timestamps) | breaks the simple filter |

## Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-082: date-only report filters use the Bahrain day, not the UTC day` | `apps/api/src/reporting/transactionsReportDay.new.test.ts` | ❌ fails: deepEqual mismatch (01:00-Bahrain payment missing, 01:00-next-day payment included) | ✅ passes |

```bash
cd apps/api && npx tsx --test --test-concurrency=1 src/reporting/*.test.ts src/routes/reporting.exportSummary.test.ts   # 16 pass
```
