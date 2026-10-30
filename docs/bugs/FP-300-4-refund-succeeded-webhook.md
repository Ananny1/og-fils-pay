# FP-300.4 — `refund.succeeded` webhook delivered through the outbox

| | |
|---|---|
| **Severity** | Feature (missing) · ★★ |
| **Area** | Refunds (FP-300) · Webhooks |
| **Analysis ID** | R6 |
| **Clue** | S2 FP-300 sheet: "the right webhook"; dispatcher comment "add refund.succeeded here when refunds ship, thats all it needs" (false) |
| **Owner** | Stream S6 |
| **Status** | ✅ done |

## Summary (the short note)

- **What was missing:** After a refund the shop's server was never told. `processRefund` already wrote a `refund.succeeded` row to the outbox, but the webhook dispatcher ignored it.
- **Why:** `refund.succeeded` was not in the dispatcher's list of webhook event types, and `buildEnvelope` had no case for it.
- **Trap:** the comment "add it to the list, thats all it needs" is wrong. Adding it to the list **without** an envelope case makes `buildEnvelope` throw inside Step A, which rolls back the whole pass and **stalls every merchant's webhooks** (YA's reply in the same comment says so). Envelope first, then the list.

## 4. The change

| File | Change |
|---|---|
| `apps/api/src/webhooks/envelope.ts` | `refund.succeeded` added to `WebhookEventType` and a field-by-field case: `refundId`, `transactionId`, `merchantId`, `amountFils`, `feeReversedFils`, `refundedTotalFils`, `status` (public rename of `newStatus`, same as `transaction.captured`) |
| `apps/api/src/webhooks/dispatcher.ts` | `refund.succeeded` added to `WEBHOOK_ELIGIBLE_EVENT_TYPES`; misleading comment replaced |
| `apps/api/src/webhooks/envelope.test.ts` | new: exact public shape of `refund.succeeded` |
| `apps/api/src/webhooks/dispatcher.test.ts` | new: a `refund.succeeded` outbox event is delivered once to the merchant's endpoint, signed, marked succeeded |

Delivery stays in the outbox pattern: the event is written in the same database transaction as the refund
(`processRefund.ts`), so a webhook is sent if and only if the refund committed. The reporting consumer only reads its own
event-type list, so this event does not reach its "unhandled event_type" throw.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Envelope case + list entry, existing outbox row | Uses the event already written atomically with the refund; one mapper keeps the public contract explicit | — | ✅ |
| 2 | Only add to the list (what the comment said) | One line | `buildEnvelope` throws → whole webhook queue stalls | |
| 3 | Send the webhook directly from the refund route | No dispatcher change | Not atomic with the refund; no retries/backoff/signing reuse | |
| 4 (creative) | Make `buildEnvelope`'s default skip unknown types (mark undeliverable) instead of throwing | One bad type can never stall the queue again | Hides mistakes silently; a separate robustness change, not this feature | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| `refund.succeeded maps to the documented public data shape` | `apps/api/src/webhooks/envelope.test.ts` | ❌ "unsupported event type" | ✅ |
| `a refund.succeeded outbox event is delivered to the merchant's endpoint` | `apps/api/src/webhooks/dispatcher.test.ts` | ❌ 0 deliveries | ✅ 1 signed delivery, succeeded |
| other dispatcher/envelope tests | same files | ✅ (except the known BUG-060 backoff test) | same |
| `a successful refund enqueues exactly one refund.succeeded outbox event` | `apps/api/src/payments/processRefund.test.ts` | ✅ | ✅ |

Existing tests changed: none.
