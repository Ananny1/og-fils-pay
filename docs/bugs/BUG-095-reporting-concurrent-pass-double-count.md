# BUG-095 — Two reporting passes at once count the same event twice

| | |
|---|---|
| **Severity** | High |
| **Area** | Reporting |
| **Clue** | `cursor.ts` comment "no FOR UPDATE ... nvm the running flag guards it"; `catchUp.ts` "rollup looked high after" |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

The RUNBOOK says `reporting catch-up` is safe to run while the worker is live. It is not.
If both read the watermark before either commits, both apply the same events, so the
merchant's dashboard shows double captures and double gross volume for that day.

Reproduce: hold a row lock on a merchant's `merchant_daily_volume` row, start two
`runConsumerPass` calls, release. `captured_count` becomes 2 for one event.

## 2. Why it happened — the root cause

Present in the original code: `apps/reporting/src/consumer/cursor.ts:32` at 8b58b0f.

```ts
SELECT last_processed_id FROM reporting_outbox_cursor WHERE consumer_name = $1
```

A plain read, no lock. The comment in `runConsumerPass.ts:17` ("two processes using the same
name serialize on that row") is false: they only meet on the final `UPDATE`, after both have
already applied the events. The `running` flag in `listener.ts` only guards passes inside one process.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Daily volume / capture counts inflated | Wrong business numbers |
| FilsPay ops | Running catch-up per RUNBOOK silently corrupts rollups; only `rebuild` fixes it | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/reporting/src/consumer/cursor.ts:32` | `... WHERE consumer_name = $1 FOR UPDATE` |

The second pass now waits on the cursor row until the first commits, then (READ COMMITTED
re-read) sees the new watermark and finds nothing to do. One-line change, no schema change.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | `FOR UPDATE` on cursor read | One line, exact fix | Passes serialize (already the intent) | ✅ |
| 2 | `pg_advisory_xact_lock` per consumer | Same effect | Extra lock id to manage | |
| 3 | Per-event dedup table | Also protects other paths | New table + write per event | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| two concurrent passes apply one captured event exactly once | `apps/reporting/src/consumer/concurrentPass.new.test.ts` | ❌ `2 !== 1` | ✅ pass |
