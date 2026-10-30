# BUG-051 — Two API replicas send every webhook twice

| | |
|---|---|
| **Severity** | High |
| **Area** | Webhooks (outbound) |
| **Clue** | Dispatcher comments "MK: no SKIP LOCKED — only ever run ONE api replica" / "FH: staging ran 2 replicas, never saw a dup" |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

With two API processes (or a rolling deploy where old and new overlap), both dispatchers pick the same
due delivery and both POST it. Merchants receive each event twice. For `settlement.paid` the
pre-delivery effect (`recordPayoutDisbursementEffect`) also runs twice. Reproduce: run two
`runDispatchPass` calls at the same time with a slow receiver → 2 requests for one delivery.

## 2. Why it happened — the root cause

`apps/api/src/webhooks/dispatcher.ts` Step B (before) is a plain read, then a slow loop of HTTP calls:

```ts
const dueResult = await pool.query(
  `SELECT ... FROM webhook_deliveries wd ... WHERE wd.status = 'pending' AND wd.next_attempt_at <= now()
   ORDER BY wd.next_attempt_at ASC LIMIT $1`, ...);
for (const row of dueResult.rows) { await attemptOneDelivery(...) }
```

Nothing marks a row as taken, so every dispatcher that reads before the first one finishes the
HTTP call sees the same rows. The "never saw a dup in staging" claim is survivorship: duplicates
only show when two passes overlap, and nobody checked receivers.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Duplicate events (double fulfilment if they don't dedupe) | High |
| FilsPay finance | `settlement.paid` disbursement effect recorded twice | High |
| Ops | Cannot scale the API past one replica safely | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/webhooks/dispatcher.ts` | New `claimNextDueDelivery`: one statement that selects the next due row `FOR UPDATE SKIP LOCKED` and pushes its `next_attempt_at` out by a lease (request timeout + 60 s). Step B claims and attempts one row at a time, up to the same batch limit |

```sql
WITH claimed AS (SELECT id ... ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED)
UPDATE webhook_deliveries wd SET next_attempt_at = now() + lease FROM claimed, webhook_endpoints we ...
RETURNING ...
```

The claim is a short autocommit statement, so the HTTP call still never holds a DB transaction (the
original design goal). If the process dies mid-attempt the row is due again when the lease ends
(at-least-once; receivers dedupe on `Webhook-Delivery-Id`). A row that throws is retried after the
lease instead of every pass.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Claim with `SKIP LOCKED` + lease on `next_attempt_at` | No schema change, no long tx, crash-safe | Crash → retry waits for the lease | ✅ |
| 2 | `SELECT ... FOR UPDATE SKIP LOCKED` inside a tx around the HTTP call | Simple | Holds a tx + pool connection per slow receiver (pool exhaustion on 512 MB) | |
| 3 | `pg_advisory_lock` so only one dispatcher runs | Tiny | No horizontal scale; lock lost on connection drop | |
| 4 | Add an `in_progress` status | Explicit | Migration + a sweeper for stuck rows | |

## 6. Proof — tests

| Test | File | Before | After |
|---|---|---|---|
| two concurrent passes → 1 send | `apps/api/src/webhooks/dispatcher.new.test.ts` | ❌ 2 sends | ✅ 1 |
| whole webhooks suite | `src/webhooks/*.test.ts`, `src/routes/webhooks.test.ts` | — | ✅ 55/55 |

```bash
cd apps/api && npx tsx --test src/webhooks/dispatcher.new.test.ts
```

Existing tests changed: none.
