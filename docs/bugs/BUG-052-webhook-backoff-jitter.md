# BUG-052 — Webhook retry schedule is random by default (and can exceed the cap)

| | |
|---|---|
| **Severity** | Low |
| **Area** | Webhooks (outbound) |
| **Clue** | The one pre-existing failing dispatcher test (`expected 1000, actual 985`) |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

`dispatcher.test.ts` "failing endpoint: backoff/exhaustion sequence" failed on most runs. The retry
delays merchants and ops are told about (base × 2^(n−1), capped) were never the actual delays, and
at the cap a retry could wait 10 % longer than the configured maximum.

## 2. Why it happened — the root cause

`apps/api/src/webhooks/dispatcher.ts` `backoffDelayMs` (before):

```ts
jitter: () => number = Math.random,
...
return Math.round(capped * (0.9 + jitter() * 0.2));   // ±10 %, applied after the cap
```

The default parameter made jitter always on, in production and in the test that asserts
`backoffDelayMs(1, config) === 1000`. Jitter was applied after the cap, so the cap was not a cap.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Retry times differ from the documented schedule | Low |
| FilsPay (eng / ops) | Red CI; "max wait" config not honoured | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/webhooks/dispatcher.ts` | `jitter` is optional; without it return the exact capped value; with it, clamp to the cap |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Deterministic by default, jitter opt-in and clamped | Matches docs + test; cap honoured | Herd-smoothing only when asked | ✅ |
| 2 | Keep jitter, loosen the test to ±10 % | Smooths retries | Test stops pinning the schedule; cap still broken | |
| 3 | Remove jitter entirely | Simplest | Loses the option | |

Retries of many deliveries are already spread out by their own failure times, so default jitter
adds little here.

## 6. Proof — tests

| Test | File | Before | After |
|---|---|---|---|
| exact schedule 1000/2000/4000/cap | `apps/api/src/webhooks/dispatcherBackoff.new.test.ts` | ❌ | ✅ |
| jitter ≤ cap | same | ❌ (up to 66 000 > 60 000) | ✅ |
| existing backoff/exhaustion test | `apps/api/src/webhooks/dispatcher.test.ts` | ❌ 985 ≠ 1000 | ✅ |

```bash
cd apps/api && npx tsx --test src/webhooks/dispatcherBackoff.new.test.ts src/webhooks/dispatcher.test.ts
```

Existing tests changed: none.
