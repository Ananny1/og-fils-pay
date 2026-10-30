# BUG-079 — A disabled webhook endpoint keeps receiving deliveries

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Webhooks |
| **Analysis ID** | — (new, bug hunt) |
| **Clue** | `update.ts` docblock: `status: 'disabled'` is "pause without losing history"; replay refuses a disabled endpoint (`endpoint_disabled`) |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-079` |
| **Owner** | Sayed |
| **Evidence** | test below |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/webhooks/dispatcher.ts:223-224` (Step B join without status check) at 8b58b0f.

## Summary (the short note)

- **What's wrong:** after a merchant pauses (disables) a webhook endpoint, FilsPay keeps sending signed payment events to it.
- **Why:** the dispatcher's retry step selects due deliveries without checking the endpoint's status; only the step that creates new rows checks it.
- **What it breaks:** a merchant who disables a broken or leaked receiver URL still has payment data pushed to it, and the queued retries burn out to `exhausted` instead of waiting.

## 1. The issue — what was wrong

1. Receiver is down; a `transaction.captured` delivery fails once and a retry is queued.
2. Merchant sets the endpoint to `disabled` (PATCH `status: "disabled"`).
3. When the retry comes due the dispatcher still POSTs to the disabled URL, and keeps going
   until `WEBHOOK_MAX_ATTEMPTS`, then marks it `exhausted`.

## 2. Why it happened — the root cause

`apps/api/src/webhooks/dispatcher.ts`, `attemptDueDeliveries` (Step B):

```sql
FROM webhook_deliveries wd
JOIN webhook_endpoints we ON we.id = wd.endpoint_id
WHERE wd.status = 'pending' AND wd.next_attempt_at <= now()
```

Step A (`createMissingDeliveries`) joins with `we.status = 'active'`, and the replay paths
refuse a disabled endpoint, but Step B has no such check.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | payment metadata sent to a URL the merchant switched off | Low–Medium |
| Merchants | "pause" does not pause; retries are used up while paused and must be replayed by hand | Medium |
| FilsPay (finance / ops) | outbound traffic to endpoints merchants turned off | Low |
| Acquirer / card scheme / partners | — | none |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/webhooks/dispatcher.ts` (`attemptDueDeliveries`) | join condition adds `AND we.status = 'active'` |

Paused rows stay `pending` with their attempt count unchanged; when the endpoint is set back to
`active` the next pass sends them. No schema change; the due index is unchanged.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Skip disabled endpoints in Step B; rows wait | one line; true pause; nothing lost | paused rows stay in the due index | ✅ |
| 2 | On disable, mark pending rows `failed` | due index stays small | re-enable needs a manual replay; history looks like failures | |
| 3 | Check status inside `attemptOneDelivery` and push `next_attempt_at` out | rows leave the due set | more code, still polls them | |

**Why we chose #1:** smallest change that makes "disabled" mean what update.ts and replay already say it means.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-079: queued retries are not sent while the endpoint is disabled, and resume when re-enabled` | `apps/api/src/webhooks/dispatcherDisabled.new.test.ts` | ❌ "nothing is sent to a disabled endpoint" (2 sends) | ✅ passes |

```bash
cd apps/api && npx tsx --test --test-concurrency=1 src/webhooks/*.test.ts src/routes/webhooks.test.ts   # 68 pass
```

Existing tests changed: none.
