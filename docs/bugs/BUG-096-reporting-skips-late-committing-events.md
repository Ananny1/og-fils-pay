# BUG-096 — Reporting skips an event whose transaction commits late

| | |
|---|---|
| **Severity** | High |
| **Area** | Reporting |
| **Clue** | `runConsumerPass.ts` comment "ids come from a sequence, they're monotonic. fine for now." |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

Two captures run at the same time. Capture A gets outbox id N, capture B gets N+1, and B
commits first. If the worker runs in between, it applies N+1 and moves its watermark to N+1.
When A commits, N is below the watermark and is **never** applied. The merchant's daily
volume is permanently short by that capture; only a full `rebuild` brings it back.
Under real checkout load this happens regularly.

## 2. Why it happened — the root cause

Present in the original code: `apps/reporting/src/consumer/runConsumerPass.ts:45-53` at 8b58b0f.

```ts
// MK 2026-06: ids come from a sequence, they're monotonic. fine for now.
SELECT ... FROM outbox_events WHERE id > $1 ... ORDER BY id ASC
```

Sequence ids are monotonic in **insert** order, not **commit** order. A row with a lower id can
become visible after a higher one. The comment is a false claim (trap).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Dashboard volume / capture counts silently too low | Wrong numbers, no error |
| FilsPay ops | Parity warning in `applyBatchClosed` fires, cause unclear; fix needs a full rebuild | Medium |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0115_outbox_commit_order_cursor.sql` | `outbox_events.txid xid8 DEFAULT pg_current_xact_id()` (old rows `'0'`), index `(txid, id)`; `reporting_outbox_cursor.last_processed_txid` |
| `apps/reporting/src/consumer/runConsumerPass.ts` | Walk rows in `(txid, id)` order, only rows with `txid < pg_snapshot_xmin(pg_current_snapshot())` |
| `apps/reporting/src/consumer/cursor.ts` | Read / advance / reset the txid part of the watermark |

```sql
WHERE (txid, id) > ($1::xid8, $2::bigint)
  AND txid < pg_snapshot_xmin(pg_current_snapshot())
ORDER BY txid ASC, id ASC
```

Every row written by a transaction older than the oldest running one is final, and any row
still to come has a larger txid, so nothing can appear behind the watermark any more. Old rows
keep txid `'0'` and the cursor starts at `('0', last_processed_id)`, so the deploy neither
replays nor skips anything. Producers (API, Go settlement, seed) need no change: the column default fills it.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | `(txid, id)` watermark + xmin horizon | Exact, no locks on writers, standard pattern | One migration; a very long open transaction delays reporting (not loses) | ✅ |
| 2 | Re-scan a time/ id window behind the watermark + per-event dedup table | No xid logic | Extra table and write per event; window is a guess | |
| 3 | Advisory lock around every outbox insert until commit | Simple | Serialises all captures: kills throughput | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| an event that commits after a higher-id event was consumed is still applied | `apps/reporting/src/consumer/commitOrder.new.test.ts` | ❌ `1 !== 2` (slow capture lost) | ✅ pass |
| Whole reporting suite | `npm test -w apps/reporting` | — | ✅ 14/14 |
