# BUG-053 — Delivery with an undecryptable endpoint secret is retried forever and can stall all webhooks

| | |
|---|---|
| **Severity** | High |
| **Area** | Webhooks (outbound) |
| **Clue** | Dispatcher catch-block comment "degrades to 'this one row never progresses'"; test logs full of `stored ciphertext is too short` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

If an endpoint's stored secret cannot be decrypted (key rotated without re-encrypting, corrupt row),
its deliveries stayed `pending` with `attempt_count = 0` forever. They never showed as failed to the
merchant or ops. Worse, Step B picks the **100 oldest-due** pending rows each pass; these rows are
always the oldest, so once ~100 of them pile up, no other merchant gets any webhook — a silent,
platform-wide stall.

## 2. Why it happened — the root cause

`apps/api/src/webhooks/dispatcher.ts` (before): `decryptSecret` throws inside `attemptOneDelivery`,
and the Step B catch only logs:

```ts
} catch (err: unknown) {
  // Deliberately leave this row's status/attempt_count/next_attempt_at untouched:
  // it is simply retried next pass ... degrades to "this one row never progresses"
  console.error(...);
}
```

The comment assumes the failure "self-heals if transient". A decryption failure is never transient.
`next_attempt_at` is not moved either, so the row stays at the head of the queue.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchant with the bad secret | Never receives events, never sees a failure | High |
| All other merchants | Starved once ≥ 100 such rows exist | High |
| FilsPay ops | Logs spam every 5 s; nothing in the delivery log | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/webhooks/dispatcher.ts` `attemptOneDelivery` | Catch the decrypt error; set the row `status = 'failed'` with `response_body_excerpt` explaining why; nothing is sent |

Other throws (e.g. a transient DB error) keep the existing retry behaviour. The `failed` status
already existed in the schema (0022) but was never used. Once the secret is rotated the merchant/ops
can replay the delivery.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Mark `failed` with a reason | Visible, stops the loop, replayable | — | ✅ |
| 2 | Count it as an attempt and back off | Reuses existing path | Burns attempts on a permanent error; still noise | |
| 3 | Push `next_attempt_at` forward only | Unblocks the queue | Still invisible, still retried forever | |

## 6. Proof — tests

| Test | File | Before | After |
|---|---|---|---|
| undecryptable secret → `failed`, nothing sent | `apps/api/src/webhooks/dispatcher.new.test.ts` (committed with BUG-051) | ❌ `pending` | ✅ |
| per-row isolation (existing) | `apps/api/src/webhooks/dispatcher.test.ts` | asserted the bug (`pending`) | ✅ asserts `failed` |

```bash
cd apps/api && npx tsx --test src/webhooks/dispatcher.test.ts
```

Existing tests changed: `dispatcher.test.ts` per-row isolation test now expects the poisoned row to be
`failed` instead of `pending` (it pinned the bug). The healthy-sibling assertions are unchanged.
