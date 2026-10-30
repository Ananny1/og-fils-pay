# BUG-103 — Transaction timeline returns every event row with no limit

| | |
|---|---|
| **Severity** | Low |
| **Area** | Scalability |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/transactions/events.ts:110-114` at 8b58b0f (`SELECT ... FROM transaction_events WHERE transaction_id = $1 ORDER BY occurred_at ASC, id ASC` — no `LIMIT`).

## Summary

- **What's wrong:** `GET /v1/transactions/:id/events` loads and returns all event rows of a transaction, however many there are.
- **Why:** `listTransactionEvents` has no `LIMIT`.
- **What it breaks:** a transaction with a runaway number of events (bad retry loop, bulk insert) makes every timeline request load an unbounded result into memory — against the project rule "no in-memory loads of unbounded data".

## 1. The issue

Give one transaction 601 events; the endpoint returns all 601 in one response.

## 2. Root cause

```ts
// apps/api/src/transactions/events.ts (8b58b0f)
`SELECT ... FROM transaction_events
  WHERE transaction_id = $1
  ORDER BY occurred_at ASC, id ASC`,   // no LIMIT
```

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | slow/huge timeline response only in the abnormal case | low |
| Ops | memory/DB load per request is unbounded | low–medium |

## 4. Fix

`LIMIT $2` with `TRANSACTION_EVENTS_MAX = 500`, keeping `ORDER BY occurred_at ASC, id ASC` and the plain-array response shape. Served by the existing index `idx_transaction_events_transaction (transaction_id, occurred_at)` (0018). A normal transaction has a handful of events (authorize, captures, refunds), so real timelines are never cut.

## 5. Options ranked

1. **Fixed cap of 500, oldest first (chosen)** — smallest, no API change.
2. Keyset cursor (`?cursor=`) like `/v1/transactions` — complete, but changes the response shape the dashboard reads.
3. Cap at the route instead of the query — still loads every row first; rejected.

## 6. Proof

Test: `apps/api/src/routes/transactionEvents.limit.new.test.ts`

Before the fix:
```
✖ BUG-103: the events timeline is bounded (max 500 rows, oldest first)
  AssertionError: expected a bounded page of 500, got 601   (601 !== 500)
```
After the fix (with `refunds.test.ts`, which reads the timeline): `ℹ pass 9  ℹ fail 0`; `tsc --noEmit` clean.
