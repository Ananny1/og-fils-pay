# BUG-006 — Duplicate acquirer callbacks are applied twice

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Webhooks (inbound) · Data integrity |
| **Analysis ID** | W2 (FP-201, "fixed" but wasn't) |
| **Clue** | HANDOVER "Callbacks are recorded in `processed_events` before they're applied, so redeliveries are dropped"; CHANGELOG "Callbacks are now deduplicated on `callbackId`"; 0051 MK "FP-238 adds a unique index here as well — done" / AM "can't find processed_events or FP-238's index anywhere" |
| **Owner** | Ebrahim (stream S3) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** When the acquirer sends the same fraud-review callback twice (it retries when it gets no 2xx in time), we store it twice. Two retries at the same moment store it three times.
- **Why:** `applyAcquirerCallback` does a plain `INSERT` into `acquirer_callback_notes`. There is no `processed_events` table and no unique index on `callback_id`, though three documents say there is.
- **What it breaks:** The transaction timeline shows the same verdict two or three times, so support and risk see "two fraud confirmations" and may act twice (void + refund). Anything that counts verdicts is wrong.

## 1. The issue

Before the fix: post the same signed callback twice to `POST /v1/acquirer/callbacks` → both 200,
`SELECT count(*) FROM acquirer_callback_notes WHERE callback_id = ...` → **2**. Three concurrent
calls → **3**.

## 2. Why it happened

`apps/api/src/acquirer/callbacks.ts` (before):

```ts
await pool.query(
  `INSERT INTO acquirer_callback_notes (...) VALUES ($1, $2, $3, $4, $5, $6, $7)`, ...);
```

`db/migrations/0051_acquirer_callback_notes.sql` only creates a non-unique index on
`(transaction_id, created_at)`. `processed_events` does not exist in any migration.

False claims (trap protocol, already listed as T-31 / T-32):

| Where | Claim | Truth |
|---|---|---|
| `docs/HANDOVER.md` "Callbacks" | recorded in `processed_events` first, so redeliveries are dropped | No such table anywhere |
| `CHANGELOG.md` | "Callbacks are now deduplicated on `callbackId`" | No dedupe in code or schema |
| `0051` MK comment | "FP-238 adds a unique index here as well — done" | No such index (AM's reply under it is right) |

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Double "confirmed_fraud" notes can lead to double action on their payments | High |
| FilsPay (support / risk) | Timeline and verdict counts are wrong; trust in the audit trail drops | High |
| Acquirer | Their normal at-least-once retry is treated as a new event | Medium |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0084_acquirer_callback_notes_unique_callback_id.sql` | Removes existing redelivered copies (keeps the earliest per `callback_id`), then `CREATE UNIQUE INDEX ... ON acquirer_callback_notes (callback_id)` |
| `apps/api/src/acquirer/callbacks.ts` | `INSERT ... ON CONFLICT (callback_id) DO NOTHING`; doc comment says it is idempotent |

A redelivery still gets 200 (`{ received: true }`), so the acquirer stops retrying. The database
enforces it, so concurrent requests and several API replicas are covered too.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Unique index on `callback_id` + `ON CONFLICT DO NOTHING` | Two small changes; race-proof (database decides); what ANALYSIS W2 proposed | A second callback reusing an old id would be dropped (the acquirer's contract says ids are unique) | ✅ |
| 2 | Build the documented `processed_events` table and insert into it in the same transaction | Matches HANDOVER; reusable for other inbound events | New table + transaction handling for one caller; more code to review | |
| 3 | `SELECT ... WHERE callback_id = $1` before the insert | No migration | Check-then-insert race: two concurrent retries both pass (the exact pattern behind BUG-008) | |
| 4 (creative) | Unique on a hash of the raw signed body | Also dedupes callbacks that lost their id | Same callback re-signed with a new timestamp has a different body; misses real duplicates | |

**Why we chose #1:** smallest change that makes the database guarantee "once per callback", including under concurrency.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| applied twice with the same callbackId records one note | `apps/api/src/acquirer/callbacks.test.ts` | ❌ 2 notes | ✅ 1 |
| two concurrent deliveries of the same callbackId record one note | same | ❌ 3 notes | ✅ 1 |
| a redelivered callback is acknowledged but recorded once | `apps/api/src/routes/acquirerCallbacks.test.ts` | (new) | ✅ 200, 200, 1 note |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -T -e DATABASE_URL=... -v "$PWD/db:/app/db" migrate
docker compose -f ops/docker-compose.yml run --rm --no-deps -T -e DATABASE_URL=... api \
  npx tsx --test apps/api/src/acquirer/callbacks.test.ts apps/api/src/routes/acquirerCallbacks.test.ts
# 15 pass, 0 fail; tsc --noEmit -p apps/api clean
```

Existing tests changed: none (new tests only).
