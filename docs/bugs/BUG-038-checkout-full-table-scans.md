# BUG-038 — Every capture full-scans the whole ledger and holds tables

| | |
|---|---|
| **Severity** | High (capacity / load test) |
| **Area** | Money (checkout) · Performance |
| **Analysis ID** | — (found while reviewing the checkout hot path) |
| **Clue** | Load-test brief: one 0.5 vCPU API, checkout scenario |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-038` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

Checkout gets slower with every payment ever made. Each capture does work proportional to the size
of the whole ledger and the whole holds table, while it still holds row locks on the transaction and
the payment link. On a seeded or long-running database a load test sees latency climb, CPU pinned,
and lock waits pile up behind slow commits.

## 2. Why it happened — the root cause

Three lookups on the capture path have no supporting index (checked every migration; the only
`ledger_entries` index is `(merchant_id, occurred_at)`, `holds` has none):

| Query | Where | Runs |
|---|---|---|
| `SELECT SUM(...) FROM ledger_entries WHERE entry_group_id = $1` | deferred trigger `check_ledger_group_balance` (`db/migrations/0007_ledger_double_entry.sql:43`) | once **per inserted ledger row** at COMMIT → 4× per capture |
| `UPDATE holds SET status='released' WHERE transaction_id = $1 AND status='active'` | `apps/api/src/payments/capture.ts`, `void.ts` | once per capture / void |
| `... FROM ledger_entries WHERE transaction_id = $1` | `discountAdjustment.ts`, `processRefund.ts` | per API capture / refund |

`EXPLAIN ANALYZE` with 200k ledger rows / 100k holds (seeded in a rolled-back transaction):

| Query | Before | After |
|---|---|---|
| ledger balance trigger | Parallel **Seq Scan**, 9.5 ms | Bitmap Index Scan, 0.03 ms |
| hold release | **Seq Scan**, 4.6 ms | Index Scan, 0.06 ms |
| ledger by transaction | Parallel **Seq Scan**, 7.4 ms | Bitmap Index Scan, 0.02 ms |

So a capture spent ~40 ms of CPU in full scans at 200k rows, growing linearly (quadratic over the
life of the platform), and inside its locks.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers | Slow / timing-out checkout under load | High |
| Merchants | Same; also slower API captures and refunds | Medium |
| FilsPay ops | CPU on the 0.5 vCPU budget burned on scans; longer lock hold times widen every race window | High |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0076_checkout_hot_path_indexes.sql` | `idx_ledger_entries_entry_group (entry_group_id)`, `idx_holds_transaction (transaction_id)`, `idx_ledger_entries_transaction (transaction_id)` |

No code change. Indexes are the smallest fix that removes the root cause (unindexed equality
lookups); the trigger and queries stay exactly as they are.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Add the three b-tree indexes | No code change; O(log n) | Small write overhead per insert | ✅ |
| 2 | Rewrite the balance trigger as a statement-level trigger | Fewer trigger calls | Still scans without an index; touches an accounting invariant | |
| 3 | Partial index on `holds (transaction_id) WHERE status = 'active'` | Smaller | Void/refund code may look up released holds too | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-038: lookups every capture runs are index-backed, not full scans` | `apps/api/src/payments/capture.new.test.ts` | ❌ no such indexes | ✅ |

```bash
DATABASE_URL=... npm run migrate
DATABASE_URL=... npx tsx --test apps/api/src/payments/capture.new.test.ts
```

The EXPLAIN numbers above came from a script that seeds rows inside `BEGIN … ROLLBACK`, runs
`EXPLAIN (ANALYZE)` on the three queries, and leaves the database unchanged.
Existing tests changed: none.
