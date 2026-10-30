# BUG-024 — Settlement summary double-counts multi-capture merchants (and is slow)

| | |
|---|---|
| **Severity** | High |
| **Area** | Money · Reporting |
| **Analysis ID** | Q1 |
| **Clue** | `docs/perf/2026-07-settlement-summary-slow.md` — summary +38 % vs batches for Delta Wholesale, "explained" as a timing difference |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

`GET /v1/settlement/summary` showed Delta Wholesale (captures orders in 2–3 parts) about 38 % more
captured money than their batches ever paid. Single-capture merchants matched, so it looked like a
"timing difference". It is not: the number is simply wrong, and it never "resolves at month end".
The same query took 3–6 s for that merchant.

## 2. Why it happened — the root cause

`apps/api/src/settlement/query.ts` `getSettlementSummary` (before):

```sql
WITH captured AS (
  SELECT t.id, t.captured_fils               -- running TOTAL of the transaction
    FROM transactions t
    JOIN transaction_events te ON te.transaction_id = t.id   -- one row per capture EVENT
   WHERE ... te.occurred_at in window)
SELECT COUNT(DISTINCT id), SUM(captured_fils) FROM captured   -- total × number of events
```

The join fans out to one row per capture event, then sums the transaction's full total on each row.
3 partial captures of 10.000 BD → 30.000 BD. It also books the full total on every day that had one
of its captures. Batches (`apps/settlement/.../batch.go`) correctly sum `te.amount_fils` (the delta of
each event). The perf note's "Claude explained it is a timing difference" was accepted without a check
(trap: AI-explanation-as-evidence). Slowness: no index fits "capture events of these transactions in
this window", so Postgres seq-scanned all of `transaction_events`.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants (multi-capture) | Dashboard overstates expected settlement → disputes, "where is my money" tickets | High |
| FilsPay finance / support | Summary ≠ batches; wrong explanation given to support | High |
| All merchants | Slow settlement page for big merchants; DB load on a 1 vCPU host | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/settlement/query.ts` | Sum `te.amount_fils` (each capture's delta) and count `DISTINCT te.transaction_id` — same basis as CloseBatch |
| `db/migrations/0082_transaction_events_capture_summary_index.sql` | Partial covering index `(transaction_id, occurred_at) INCLUDE (amount_fils) WHERE event_type IN ('captured','partially_captured')` |

```sql
SELECT COUNT(DISTINCT te.transaction_id), COALESCE(SUM(te.amount_fils), 0)
  FROM transaction_events te JOIN transactions t ON t.id = te.transaction_id
 WHERE t.merchant_id = $1 AND te.event_type IN ('captured','partially_captured')
   AND te.occurred_at >= $2 AND te.occurred_at < $3
```

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Sum event deltas (`te.amount_fils`) | Matches batches by construction; correct across day boundaries | — | ✅ |
| 2 | `SUM(DISTINCT ...)` / dedupe transactions then sum `captured_fils` | Fixes the ×N | Still books a cross-day capture fully on both days; `DISTINCT` on amounts is wrong when two txns have equal totals | |
| 3 | Raise `shared_buffers` only (what was done in July) | No code | Wrong numbers stay; only hides slowness | |

## 6. Proof — tests

| Test | File | Before | After |
|---|---|---|---|
| 3-part capture counted once (11 250) | `apps/api/src/settlement/query.new.test.ts` | ❌ 31 250 | ✅ |
| capture split over 2 Bahrain days | same | ❌ 10 000 on day 1 | ✅ 3 000 / 7 000 |
| existing summary route tests | `apps/api/src/routes/settlement.test.ts` | ✅ | ✅ |

```bash
npm run migrate && cd apps/api && npx tsx --test src/settlement/query.new.test.ts src/routes/settlement.test.ts
```

Existing tests changed: none.
