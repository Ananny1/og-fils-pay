# BUG-059 — Reporting consumer hits `merchant_id = NULL` (poisoned outbox rows from a test fixture)

| | |
|---|---|
| **Severity** | High (for the test suite / CI); no production code path produces it |
| **Area** | Reporting · Tests |
| **Analysis ID** | T1 test baseline, failure #2 |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** after the API tests run, all 4 database tests in `apps/reporting` fail with `null value in column "merchant_id" of relation "merchant_daily_volume"`.
- **Why:** the API test `webhooks/archiveReplay.test.ts` inserts real-looking `transaction.captured` / `transaction.voided` rows into `outbox_events` with an **empty payload `{}`** (no `merchantId`), only to satisfy a foreign key. The reporting consumer reads every outbox event of those types, tries to roll up a row with `merchantId = undefined`, and the whole pass fails. Because a pass is all-or-nothing, it fails **every time**, forever.
- **What it breaks:** the reporting suite is red, so real reporting bugs can hide behind it. In a shared dev DB the reporting worker also stops updating the dashboards until those rows are removed.

The T1 baseline guessed "the consumer reads `merchant_id` from a place the producers don't put it". That guess is **wrong**: every real producer (`capture.ts`, `void.ts`, Go `batch.go`) sends `merchantId`, and the consumer reads `payload.merchantId` correctly. Run on their own, the reporting tests are green (11/11).

## 1. The issue

Reproduce on a clean DB:

```bash
npx tsx --test apps/api/src/webhooks/archiveReplay.test.ts   # leaves 5 '{}' transaction.* outbox rows
npm test --workspace @filspay/reporting                        # 7 pass, 4 fail (NULL merchant_id)
```

## 2. Why it happened — the root cause

`apps/api/src/webhooks/archiveReplay.test.ts` `insertDelivery()` (before):

```ts
`INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
 VALUES ($1, 'transaction', $2, '{}'::jsonb) RETURNING id`,
[opts.eventType, randomUUID()],      // opts.eventType = 'transaction.captured' / 'transaction.voided'
```

`apps/reporting/src/consumer/applyEvent.ts` then runs `INSERT INTO merchant_daily_volume (merchant_id, ...) VALUES ($1, ...)` with `payload.merchantId` = `undefined` → NULL → NOT NULL violation → the whole pass rolls back (by design, see the atomicity test) → the watermark never moves past the bad row.

`apps/api/src/routes/admin.test.ts` already does this correctly: it uses an inert type `'admin.test.replay_fixture'` with `processed_at = now()` and a comment explaining exactly this risk. `archiveReplay.test.ts` did not follow that rule.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Developers / CI | 4 reporting tests always red after the API suite | Medium: hides real failures |
| Dev / staging dashboards | Reporting worker stuck on the bad row in a shared DB | Medium |
| Merchants (production) | Not affected: no production producer writes `{}` payloads | None |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/webhooks/archiveReplay.test.ts` | The FK-only outbox row now uses an inert event type `'archive.test.replay_fixture'` and `processed_at = now()` (same convention as `admin.test.ts`). The delivery row still carries the real `event_type`, which is all the archive code reads. |

No production code changed: the consumer's "fail the whole pass on a bad event" behaviour is the documented exactly-once design (`runConsumerPass` atomicity test).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Fix the fixture: inert event type for the FK-only outbox row | Removes the cause; matches the existing `admin.test.ts` convention; zero production risk | Only protects against this one test | ✅ |
| 2 | Fixture keeps the real type but adds a real `merchantId` | Also green | Feeds fake volume into a merchant's rollups; still a "meaningless synthetic event" | |
| 3 (creative) | Consumer moves a malformed event to a dead-letter table and skips it | Production worker could never be stopped by one bad row | Changes the exactly-once design and breaks the atomicity test that proves it; bigger change than a 4-hour sprint allows | |
| 4 | Make the reporting tests use their own cursor/consumer name | Isolation | Does not fix the shared dev DB; large test rewrite | |

**Why we chose #1:** it is the real cause, it is one statement, and the repo already had the right pattern next door.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `runRebuild: replays to an identical rollup state…` | `apps/reporting/src/cli/rebuild.test.ts` | ❌ NULL `merchant_id` | ✅ |
| `runConsumerPass: end-to-end … merchant_daily_volume` | `apps/reporting/src/consumer/runConsumerPass.test.ts` | ❌ NULL `merchant_id` | ✅ |
| `runConsumerPass: end-to-end settlement.batch_closed …` | same | ❌ NULL `merchant_id` | ✅ |
| `runConsumerPass: atomicity …` | same | ❌ NULL `merchant_id` | ✅ |
| `archiveReplay.test.ts` (4 tests) | `apps/api/src/webhooks/archiveReplay.test.ts` | ✅ | ✅ |

Sequence used for both runs: `archiveReplay.test.ts`, then `npm test --workspace @filspay/reporting` → before 7/11, after 11/11.
Note: a DB that already ran the old fixture still holds the bad rows; remove them once with
`DELETE FROM webhook_deliveries WHERE outbox_event_id IN (SELECT id FROM outbox_events WHERE payload='{}' AND event_type LIKE 'transaction.%'); DELETE FROM outbox_events WHERE payload='{}' AND event_type LIKE 'transaction.%';` (or re-seed).

Existing tests changed (and why): `archiveReplay.test.ts` fixture only — it was the source of the bad data. Its assertions are unchanged.
