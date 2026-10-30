# BUG-081 — Restoring a webhook archive sends the same event several times

| | |
|---|---|
| **Severity** | High (duplicate money events to merchants) |
| **Area** | Webhooks |
| **Analysis ID** | — (new, bug hunt; sibling of BUG-080) |
| **Clue** | `archiveReplay.ts` replays the archive row by row; `replay.ts` mints a new delivery id per replay |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-081` |
| **Owner** | Sayed |
| **Evidence** | test below |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/webhooks/archiveReplay.ts:144` (row-by-row restore) at 8b58b0f.

## Summary (the short note)

- **What's wrong:** when ops restore an endpoint's archived history onto a new URL, the merchant receives some events two or more times, and every repeated restore sends them all again.
- **Why:** `replayWebhookDeliveryArchive` replays every archived delivery **row**; an archive holds an original and each of its replays, and each replay is sent with a fresh delivery id.
- **What it breaks:** duplicate `transaction.captured` / `settlement.paid` / `refund.succeeded` that the merchant cannot dedupe.

## 1. The issue — what was wrong

1. A `settlement.paid` delivery exhausted, then was replayed and succeeded → two rows, one event.
2. Ops archive the endpoint (both rows go in, correctly — the archive is an audit record).
3. Ops restore the archive onto the new endpoint → **2** deliveries of the same payout, with different ids.
4. Restore clicked again → 2 more.

## 2. Why it happened — the root cause

`apps/api/src/webhooks/archiveReplay.ts`, `replayWebhookDeliveryArchive`:

```ts
for (const entry of entries) {
  await insertReplayDeliveryRow(client, { id: entry.deliveryId, endpointId: input.targetEndpointId, ... });
```

No per-event dedupe, no check of what the target endpoint already has. `insertReplayDeliveryRow`
gives every copy a new `delivery_event_id`, so receivers can't drop the copies.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | — | none directly |
| Merchants | duplicate payment/payout/refund notices after a URL rotation; risk of double-booking | High |
| FilsPay (finance / ops) | support load; same failure class as incident 2026-08-21 | Medium |
| Acquirer / card scheme / partners | — | none |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/webhooks/archiveReplay.ts` | one query for outbox events the target already has `pending`/`succeeded`; the loop restores each outbox event once and skips those |

Uses the `(endpoint_id, outbox_event_id)` index from migration 0107 (BUG-080). The archive itself
is unchanged (still the complete record).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Dedupe by outbox event at restore time, skip events already on the target | small; safe to click twice | — | ✅ |
| 2 | Archive only one row per event | smaller archives | breaks the "complete record" purpose of archives | |
| 3 | Reuse the original delivery id on replay | receivers dedupe | contract change; copies still queued | |

**Why we chose #1:** fixes restore without touching what an archive records.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-081: an archive holding an original and its replay restores the event once, and only once` | `apps/api/src/webhooks/archiveReplay.new.test.ts` | ❌ replayedCount 2 | ✅ |

```bash
cd apps/api && npx tsx --test --test-concurrency=1 src/webhooks/*.test.ts src/routes/webhooks.test.ts src/routes/admin.test.ts   # 113 pass
```

Existing tests changed: none.
