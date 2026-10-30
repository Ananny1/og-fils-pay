# BUG-062 — Reporting stops for everyone when a day's rollup row is missing

| | |
|---|---|
| **Severity** | High (availability of reporting) |
| **Area** | Reliability (reporting consumer) |
| **Analysis ID** | — (found while merging the sprint) |
| **Clue** | `applyEvent.test.ts`: "anything cover a missing rollup row? claude: 'Yes, the next test covers it.'" (it didn't, T-122) |
| **Evidence** | Reporting tests 7/11 after the API suite left real events behind |
| **Decision** | D-016 |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** When a payout batch closes, the reporting worker checks its daily total against the real captures. If that day has captures but no total row yet, the worker crashes.
- **Why:** The check reads `rows[0].captured_count` without checking that a row came back.
- **What it breaks:** The crash rolls back the whole batch of events and the worker retries the same batch forever, so **every merchant's dashboard totals stop updating**. It happens in real life whenever a capture was counted under another date (rollups use the event's date, batches use the Bahrain business day, see BUG-055).

## 1. The issue

After the API suite ran on a database, the reporting suite failed 4/11 with
`TypeError: Cannot read properties of undefined (reading 'captured_count')`: the consumer met a
`settlement.batch_closed` event for a merchant/day with captures but no `merchant_daily_volume` row.

## 2. Why it happened

`apps/reporting/src/consumer/applyEvent.ts`, the parity check inside `applyBatchClosed`:

```ts
const rollup = rollupResult.rows[0] as { captured_count: number };
if (rollup.captured_count < groundTruthCount) { console.warn(...) }
```

The check exists only to **warn** about a lagging rollup. A missing row is the most-lagging case
there is, but it throws instead. `runConsumerPass` applies events in one transaction, so the throw
undoes the pass and the watermark never moves: the worker is stuck on that event.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Dashboard volumes, payout trends and analytics stop updating | High |
| FilsPay ops | A silent stuck worker (it keeps retrying the same pass) | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/reporting/src/consumer/applyEvent.ts` | A missing rollup row counts as 0: the check warns (`rollup=0 ground_truth=N`) and never throws |
| `apps/reporting/src/consumer/applyEvent.test.ts` | New test; removed the false "next test covers it" comment |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Treat a missing row as 0 and warn | One line; keeps the check's purpose (detect lag); no crash | — | ✅ |
| 2 | Skip the check when the row is missing | Also no crash | Hides exactly the lag the check is for | |
| 3 | Wrap every applier in try/catch and skip bad events | No single event can stall the worker | Silently drops data; changes the exactly-once design | |
| 4 | Creative: a dead-letter table for events that fail N times, plus an alert | The worker never stalls on any future bug | A new table and ops process: an enhancement | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| real captures but no rollup row warns and never throws | `apps/reporting/src/consumer/applyEvent.test.ts` | ❌ TypeError | ✅ one warning `rollup=0 ground_truth=1` |
| Full reporting suite on a database the API suite had used | — | ❌ 7/11 | ✅ 12/12 |

`tsc` clean.
