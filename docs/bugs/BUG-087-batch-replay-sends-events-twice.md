# BUG-087 — Admin "replay batch" sends the same webhook event twice

| | |
|---|---|
| **Severity** | High (duplicate `settlement.paid` notices) |
| **Area** | Webhooks |
| **Analysis ID** | W8 ("replay-batch keeps original delivery ids" claim — verify) |
| **Clue** | `routes/adminMerchants.ts`: "deduped receiver-side by the stable Webhook-Delivery-Id. replay keeps the original id" — false |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-087` |
| **Owner** | Sayed |
| **Evidence** | tests below |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/webhooks/replayBatch.ts:80` (per-row candidates) + `apps/api/src/webhooks/replay.ts:48` (new id per replay) at 8b58b0f.

## Summary (the short note)

- **What's wrong:** an operator's batch replay can queue the same event (e.g. `settlement.paid`) more than once for a merchant's endpoint.
- **Why:** `replayBatch.ts` replays every matching delivery row, with no check per event, and each replay gets a brand-new delivery id, so the receiver can't dedupe.
- **What it breaks:** merchants get duplicate payment / payout notifications and may book a payout twice (same class as incident 2026-08-21, BUG-008).

## 1. The issue — what was wrong

Any admin (support included) calls `POST /v1/admin/merchants/:id/webhook-endpoints/:endpointId/replay-batch`:

- **Clicked twice:** the original stays `exhausted`, so the second call replays it again → 2 pending copies.
- **Original + replay in range:** an earlier replay of the same event that also exhausted is itself
  an `exhausted` row → the event is queued twice in one call.
- **Already received:** original `exhausted`, its later replay `succeeded` → the event is sent again.

## 2. Why it happened — the root cause

`apps/api/src/webhooks/replayBatch.ts` (candidate query):

```sql
SELECT id, endpoint_id, outbox_event_id, event_type, payload
  FROM webhook_deliveries
 WHERE endpoint_id = $1 AND status = ANY($2)
   AND created_at >= $3 AND created_at < $4
 ORDER BY created_at ASC LIMIT $5
```

One replay per **row**, not per **event**, with no look at what the endpoint already has. And
`replay.ts` `insertReplayDeliveryRow` mints `newDeliveryEventId = randomUUID()`, so the
"receiver dedupes by Webhook-Delivery-Id" defence the route comment relies on does not exist.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | — | none directly |
| Merchants | duplicate `transaction.captured` / `settlement.paid` / `refund.succeeded` with different ids; double-booked payouts in their systems | High |
| FilsPay (finance / ops) | support tickets, reconciliation noise | Medium |
| Acquirer / card scheme / partners | — | none |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/webhooks/replayBatch.ts` | candidate query: `DISTINCT ON (outbox_event_id)` (latest row per event); skip events with a `pending` delivery on this endpoint; skip events already `succeeded` on it unless the caller explicitly asked for `succeeded` |
| `db/migrations/0107_webhook_deliveries_endpoint_event_index.sql` | index `(endpoint_id, outbox_event_id)` for the new per-event check (the existing unique index is partial and doesn't cover replay rows) |

The explicit "resend succeeded deliveries" operator action (existing admin test) still works, but
only once per event until it is delivered.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Dedupe candidates per event, skip events pending/delivered on the endpoint | small, local, keeps the replay contract | one extra index | ✅ |
| 2 | Make replays reuse the original `delivery_event_id` (0022 comment, ARCH §5) | receivers can dedupe everything | changes replay contract and its tests; still queues copies | |
| 3 | Mark the original row `replayed` | stops re-picking the original | needs a new status + CHECK change; doesn't cover replay rows | |

**Why we chose #1:** it stops the duplicate at the source with no API change. #2 is worth a team decision later.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `replaying the same batch twice queues the event once` | `apps/api/src/webhooks/replayBatch.new.test.ts` | ❌ 2nd call matched 1 | ✅ |
| `an exhausted original plus its exhausted replay are replayed as one event` | same | ❌ 2 queued | ✅ |
| `an exhausted original whose replay already succeeded is not re-sent` | same | ❌ re-queued | ✅ |

```bash
cd apps/api && npx tsx --test --test-concurrency=1 src/webhooks/*.test.ts src/routes/webhooks.test.ts src/routes/admin.test.ts   # 112 pass
```

Existing tests changed: none.
