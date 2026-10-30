# CAP-3 — Every payment scans the whole ledger (missing indexes)

| | |
|---|---|
| **Severity** | High (rubric: Capacity; gets worse every day in production) |
| **Area** | Money · Deploy (performance) |
| **Analysis ID** | found during CAP-1 load test (sprint stream S8) |
| **Clue** | `pg_stat_user_tables` after a 4-minute checkout load test: `ledger_entries` 22,760 seq scans, **194 million** rows read, 0 index scans |
| **Decision** | D-016 (4-hour sprint) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** each captured payment makes Postgres read the **entire** `ledger_entries`
  table several times, and `holds` once.
- **Why:** the ledger balance trigger looks rows up by `entry_group_id`, and capture/void/refund
  look them up by `transaction_id`; neither column has an index.
- **What it breaks:** checkout gets slower with every payment ever made. In the load test,
  Postgres (not the api) hit its CPU cap first.

## 1. The issue

Run the checkout load test (`docs/challenge/CAPACITY.md`) and look at the table stats:

| table | seq_scan | rows read by seq scans | idx_scan |
|---|---|---|---|
| `ledger_entries` (16,510 rows) | 22,760 | 194,641,408 | 0 |
| `holds` (2,647 rows) | 2,587 | 3,448,807 | 0 |

That is ~9 full ledger scans per payment, on a ledger that only grows.

## 2. Why it happened

`db/migrations/0007_ledger_double_entry.sql` — the deferred constraint trigger runs **once per
inserted leg** (a capture writes 4–6 legs):

```sql
SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_fils ELSE -amount_fils END), 0)
  INTO v_net
  FROM ledger_entries
 WHERE entry_group_id = v_group_id;      -- no index on entry_group_id
```

The only ledger index is `(merchant_id, occurred_at)`. Same story for
`ledger_entries.transaction_id` (`payments/discountAdjustment.ts`, `processRefund.ts`) and
`holds.transaction_id` (`UPDATE holds ... WHERE transaction_id = $1` in `capture.ts`/`void.ts`).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers | slower checkout, more "busy, retry" answers at peak | Medium, growing |
| Merchants | fewer payments per second the platform can take | Medium, growing |
| FilsPay ops | Postgres CPU burned on scans; the nightly settlement shares that CPU | High over time |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0098_capacity_ledger_indexes.sql` (new) | `idx_ledger_entries_entry_group (entry_group_id)`; `idx_ledger_entries_transaction (transaction_id) WHERE transaction_id IS NOT NULL`; `idx_holds_transaction (transaction_id) WHERE transaction_id IS NOT NULL` |

Indexes only: no behaviour change, no data change, the trigger still checks every group.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Add the three missing indexes | tiny, safe, no code change; O(log n) lookups | a little more write work per insert | ✅ |
| 2 | Make the balance trigger statement-level (one check per group, not per leg) | fewer trigger runs | bigger rewrite of a money invariant during a sprint; still scans without the index | |
| 3 | Drop the trigger and trust the application | fastest | removes the double-entry safety net — never | |
| 4 (creative) | Keep a running `net` per `entry_group_id` in a side table updated by the trigger | O(1) check | new table + trigger logic to get right; the index already gives most of the gain | |

**Why we chose #1:** biggest win for the smallest, risk-free change.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `hot per-payment ledger/holds lookups can use an index (no forced sequential scan)` | `apps/api/src/payments/ledgerIndexes.test.ts` | ❌ fails (`Seq Scan on ledger_entries` with `enable_seqscan=off`) | ✅ passes (index scans) |

Live (same k6 ramp, 1→80 users, `docs/challenge/CAPACITY.md`): ledger seq scans 22,760 → **0**;
paid checkouts/s 9.7 → 12.2 at the same CPU caps (before the CPU rebalancing of CAP-1).

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -T \
  -e DATABASE_URL=postgres://filspay:filspay_dev_password@postgres:5432/filspay_s8 \
  -v "$PWD/apps/api/src:/app/apps/api/src" api npx tsx --test apps/api/src/payments/ledgerIndexes.test.ts
```

Existing tests changed: none.
