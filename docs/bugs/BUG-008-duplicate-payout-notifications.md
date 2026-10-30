# BUG-008 — Duplicate payout notifications and duplicate disbursements

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Settlement · Webhooks · Money |
| **Analysis ID** | W6, W7 |
| **Clue** | Incident 2026-08-21 (`docs/ADMIN.md`): two merchants got `settlement.paid` twice and two disbursement records each; AM: "the two deliveries had different outbox event ids" |
| **Owner** | Ebrahim (stream S3) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** One paid settlement batch can produce two (or more) "you've been paid" webhooks **and two payout-rail disbursement instructions**, which means paying the merchant twice.
- **Why:** Three gaps stack up. (1) The Go settlement service checks "no `settlement.paid` event yet" and then inserts, with no unique index, so the daemon and a manual `run-batch` both insert. (2) The API writes a disbursement row on the first attempt of **every** delivery row, so a merchant with two webhook endpoints gets two disbursements. (3) The dispatcher reads due deliveries without claiming them, so two API replicas send the same one.
- **What it breaks:** Double payouts (real money leaves FilsPay twice), duplicate "paid" notices that merchants' systems book twice, and a finance reconciliation that no longer matches the ledger.

## 1. The issue

Reproduced in tests before the fix:

| Scenario | Expected | Before |
|---|---|---|
| `EnqueuePayoutNotifications` run twice at the same time (daemon + `run-batch`) | 1 `settlement.paid` event | **2** |
| `settlement.paid` for a merchant with 2 webhook endpoints | 1 disbursement | **2** |
| `recordPayoutDisbursementEffect` called 3 times for one batch | 1 disbursement | **3** |
| two dispatch passes at once (2 replicas) on one due delivery | sent once | **sent twice** |

## 2. Why it happened

- `apps/settlement/internal/settlement/payout_notify.go`: `SELECT ... WHERE NOT EXISTS (settlement.paid for this batch)` then a plain `INSERT`. Check-then-insert is a race.
- `apps/api/src/webhooks/dispatcher.ts` `PRE_DELIVERY_EFFECTS["settlement.paid"]` runs on `attempt_count === 0` of each delivery row (one row per endpoint); `payoutDisbursement.ts` does a plain `INSERT`; table 0057 has no unique key.
- `attemptDueDeliveries` selects `status='pending' AND next_attempt_at <= now()` with no claim; the row stays "due" during the HTTP call, so another pass sends it too.

False claims (trap protocol):

| Where | Claim | Truth |
|---|---|---|
| `payout_notify.go` FH/claude | "outbox_events has a unique index on (event_type, aggregate_id)" | Only `idx_outbox_unprocessed` exists (0009) |
| `payout_notify.go` MK | "daemon and CLI never overlap" | Nothing prevents it; it is how 2026-08-21 happened |
| `payout_notify.go` doc | "Idempotent by construction: the NOT EXISTS guard ..." | Only for sequential runs |
| `0057` tail comment | "Written inside PayoutBatch's transaction, one row per paid batch" | Written by the API dispatcher, once per delivery |
| `dispatcher.ts` MK / FH | "only ever run ONE api replica" / "staging ran 2 replicas, never saw a dup" | Nothing enforces one replica; the dup was seen (2026-08-21) |
| `docs/ADMIN.md` incident review | Root cause: reporting worker replayed NOTIFYs | The two deliveries had **different outbox event ids** (AM), so the event itself was enqueued twice (gap 1) |

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| FilsPay (finance) | Disbursement instructions issued twice: real money paid out twice and has to be clawed back | Critical |
| Merchants | Duplicate "paid" webhooks; their books show double income; later clawback | High |
| Acquirer / bank rails | Duplicate transfer instructions | Medium |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0085_payout_notification_dedupe.sql` | Unique partial index `outbox_events (event_type, aggregate_id) WHERE event_type='settlement.paid'`; unique index `settlement_payout_disbursements (settlement_batch_id)`. Existing duplicates are **kept as evidence**: later event copies re-typed `settlement.paid.duplicate`, later disbursement copies moved to new table `settlement_payout_disbursement_duplicates` for finance recovery |
| `apps/settlement/internal/settlement/payout_notify.go` | `ON CONFLICT (event_type, aggregate_id) WHERE event_type='settlement.paid' DO NOTHING`; count only inserted rows; false comment replaced |
| `apps/api/src/webhooks/payoutDisbursement.ts` | `ON CONFLICT (settlement_batch_id) DO NOTHING` |
| `db/migrations/0086_cancel_duplicate_payout_deliveries.sql` | (review fix) 0085 stopped **new** deliveries for re-typed events, but delivery rows already `pending` for them keep `event_type='settlement.paid'` and were still retried, so the duplicate notice still went out. 0086 sets those pending rows to `failed` (an existing terminal status from 0022 that the dispatcher never sets itself, so they are easy to tell apart). Rows are kept as evidence; already-sent rows untouched. 0085 itself is not edited (already applied). |
| `apps/api/src/webhooks/duplicatePayoutDeliveries.test.ts` | (review fix) 2 tests for 0086 |
| `apps/api/src/webhooks/dispatcher.ts` | Step B claims each row before sending: `UPDATE ... SET next_attempt_at = now() + lease WHERE id=$1 AND status='pending' AND next_attempt_at <= now()`; only the pass that matched sends. Lease = request timeout + 30 s. If the attempt throws, the claim is given back (old `next_attempt_at` restored). |

The two unique indexes are the real guarantee (the database decides, whatever the number of
replicas or CLIs). The claim in Step B stops the duplicate HTTP send, which a unique index cannot.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Unique indexes + `ON CONFLICT DO NOTHING` on both inserts, and a per-row lease claim in Step B | Race-proof at the DB; no transaction held during HTTP; small diff; keeps old duplicates as evidence | Lease means a crashed send waits ~35 s before retry | ✅ |
| 2 | `SELECT ... FOR UPDATE SKIP LOCKED` in one transaction around the whole Step B loop | Textbook queue claim | Holds a DB transaction open across slow HTTP calls (the code says never do that) | |
| 3 | Advisory lock so only one `EnqueuePayoutNotifications` / one dispatcher runs at a time | Simple | Does not fix the per-endpoint disbursement; a crash can hold the lock; still no DB guarantee | |
| 4 (creative) | Move the disbursement out of the webhook path into `PayoutBatch`'s own transaction (what 0057 claims) | Disbursement no longer depends on whether the merchant registered a webhook (today: no endpoint → no disbursement row at all) | Cross-service change (Go + TS), bigger than a 4-hour sprint fix; recorded as a follow-up | |

Review follow-up (pending deliveries of re-typed events), options: (1, chosen) new migration 0086 marks them `failed`: one UPDATE, keeps evidence, no runtime cost; (2) make Step B join `outbox_events` and skip `*.duplicate` types: also covers future re-types but adds a join to every dispatch pass for a one-off cleanup; (3) delete the rows: loses the evidence 0085 was careful to keep.

**Why we chose #1:** it closes all three duplicate paths with the smallest change and makes the
database the single source of "once per batch".

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestEnqueuePayoutNotificationsConcurrentRunsEnqueueOnce` (SHARE lock makes the race deterministic) | `apps/settlement/internal/settlement/payout_notify_test.go` | ❌ 2 events | ✅ 1 |
| settlement.paid to a merchant with two endpoints records exactly one disbursement | `apps/api/src/webhooks/dispatcher.test.ts` | ❌ 2 | ✅ 1 |
| two concurrent dispatch passes send a due delivery only once | same | ❌ sent 2× | ✅ 1× |
| recordPayoutDisbursementEffect called twice (or concurrently) ... one disbursement | `apps/api/src/webhooks/payoutDisbursement.test.ts` | ❌ 3 | ✅ 1 |
| per-row isolation (poisoned row left unchanged) | `dispatcher.test.ts` | ✅ | ✅ (claim is given back) |
| a delivery already pending for a `settlement.paid.duplicate` event is not sent after 0086 | `apps/api/src/webhooks/duplicatePayoutDeliveries.test.ts` | ❌ sent 1× (0086 as a no-op) | ✅ 0×, status `failed` |
| 0086 leaves a pending delivery for a normal event untouched | same | ✅ | ✅ `pending` |

Migration 0085 was applied to a test DB that already held duplicates from the red runs:
1 event re-typed, 3 disbursements moved to the duplicates table, both unique indexes created.

```bash
cd apps/settlement && DATABASE_URL=... go test ./... -count=1        # all ok
docker compose ... api npx tsx --test apps/api/src/webhooks/dispatcher.test.ts apps/api/src/webhooks/payoutDisbursement.test.ts
# 11/12 pass; the 1 failure is the known baseline backoff test (BUG-060), red before this change too
```

Existing tests changed: none (new tests only).
