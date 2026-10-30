# BUG-006 — Acquirer callbacks are not deduplicated

| | |
|---|---|
| **Severity** | High |
| **Area** | Webhooks (inbound) |
| **Analysis ID** | W2 |
| **Clue** | Postmortem 2026-05 action item FP-201 "Done"; eng-sync 2026-06-02 "no doubles since 14 May"; AM's note at the end of `0051` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

The acquirer re-sends a callback when it does not get a fast 200 (and our own
`withCallbackRetry` re-runs the insert up to 3 times). Every copy was stored, so one
fraud-review verdict showed up two, three or more times on the transaction timeline.
Reproduce: call `applyAcquirerCallback` twice with the same `callbackId` → 2 rows.

## 2. Why it happened — the root cause

`apps/api/src/acquirer/callbacks.ts` did a plain insert, and the table had no unique key:

```ts
await pool.query(`INSERT INTO acquirer_callback_notes (...) VALUES ($1, ..., $7)`, [...]);
```

`db/migrations/0051_acquirer_callback_notes.sql` says dedupe is done "by processed_events on
our side" and "FP-238 adds a unique index here as well — done". There is no `processed_events`
table and no such index anywhere. The postmortem marks FP-201 "Done". All false (TRAPS T-32).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Duplicate fraud verdicts on their transactions | Medium — confusing, may trigger double manual action |
| FilsPay (support / finance) | Timeline and any count of verdicts is inflated | Medium |
| Acquirer | None directly | — |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0081_acquirer_callback_notes_unique_callback_id.sql` | Collapse existing duplicates (keep the first), add `UNIQUE (callback_id)` |
| `apps/api/src/acquirer/callbacks.ts` | `INSERT ... ON CONFLICT (callback_id) DO NOTHING` |

A repeat is now a silent no-op and the route still answers 200, so the acquirer stops
retrying. The database enforces it, so it also holds under concurrent deliveries and across
API replicas — not just "check then insert".

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Unique index on `callback_id` + `ON CONFLICT DO NOTHING` | Atomic, tiny, race-free | Needs a migration | ✅ |
| 2 | New `processed_events` table as the docs describe | General for future callback types | More code, a second write to keep consistent | |
| 3 | `SELECT` first, insert if absent | No migration | Races: two concurrent copies both insert | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| same callback twice → 1 note | `apps/api/src/acquirer/callbacks.new.test.ts` | ❌ 2 rows | ✅ |
| 5 concurrent copies → 1 note | same | ❌ 5 rows | ✅ |
| two distinct callbacks → both kept | same | ✅ | ✅ |

```bash
npm run migrate && cd apps/api && npx tsx --test src/acquirer/callbacks.new.test.ts
```

Existing tests changed: none.
