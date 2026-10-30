# BUG-104: Webhook replay sends a new event id, so the merchant processes the event twice

**Summary:** When a webhook was replayed (merchant replay, admin batch replay or archive restore), the replay got a **new** `delivery_event_id`. That id goes out as the envelope `id` and the `Webhook-Delivery-Id` header, and receivers use it to spot duplicates. With a new id, a merchant who replayed `settlement.paid` booked the payout twice. Now a replay keeps the original id.

## 1. Issue (what a user sees)
A merchant replays a `settlement.paid` webhook that their system already processed. Their system sees an id it has never seen, so it records the payout again: the payout is counted twice.

## 2. Why (root cause)
`apps/api/src/webhooks/replay.ts` `insertReplayDeliveryRow`:
```ts
const newDeliveryEventId = randomUUID();
const replayPayload = { ...original.payload, id: newDeliveryEventId };
```
`replayBatch.ts` and `archiveReplay.ts` call the same function. The comment says this is on purpose. That claim is false: the `0022_webhook_deliveries.sql` schema comment says receivers dedupe on this id and that a replay must reuse it, and ARCHITECTURE §5 says the id stays the same across retries and replays.

Present in the original code: `apps/api/src/webhooks/replay.ts:48-49` at 8b58b0f.

## 3. Who was affected
Every merchant with a webhook endpoint whose deliveries were replayed by the merchant or by support (batch replay or archive restore). Money events (`settlement.paid`, refunds, captures) could be processed twice.

## 4. Fix (before → after)
- Before: every replay got a new random id.
- After: the replay uses the original row's `delivery_event_id`, both in the column (which becomes the header) and as the envelope `id`. Archive restore has no column, so it uses the archived envelope's `id`. A new id is created only when the envelope has no id at all. The replay still gets its own row `id`, so the attempt history is kept.
- No unique constraint covers `delivery_event_id`, so no migration was needed.
- Two older tests asserted the buggy behaviour, so I updated them. The test in `routes/webhooks.test.ts` asserted `notEqual` on the id and now asserts `equal`. In `routes/admin.test.ts` I only changed the wording.

## 5. Options (ranked)
1. **Reuse the original id in the column and the envelope (chosen).** It is the smallest change and matches the schema contract.
2. Keep a new id in the column but send the original id in the header and envelope. This adds complexity for no gain, because nothing forces the column to be unique.
3. Tell receivers to dedupe on the outbox event. This breaks the documented contract and needs every merchant to change their code.

## 6. Proof
New test `apps/api/src/webhooks/replay.new.test.ts` (single replay, batch replay, archive restore).

Before the fix:
```
✖ BUG-104: single replay keeps the original event id (column and envelope)
✖ BUG-104: admin batch replay keeps the original event id
✖ BUG-104: archive restore keeps the original event id
ℹ tests 3  ℹ pass 0  ℹ fail 3
```
After the fix (new test plus replayBatch/archiveReplay tests, BUG-080/081, routes/webhooks and routes/admin):
```
ℹ tests 63  ℹ pass 63  ℹ fail 0
```
