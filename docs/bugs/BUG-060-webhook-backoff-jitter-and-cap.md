# BUG-060 — Webhook retry backoff: test ignores jitter, and jitter can break the cap

| | |
|---|---|
| **Severity** | Medium (test always red; small production contract breach) |
| **Area** | Webhooks |
| **Analysis ID** | T1 test baseline, failure #3 |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** (1) the backoff test is red almost every run: it expects exactly `1000` ms but the function adds random ±10 % jitter. (2) The jitter is added **after** the cap, so a retry can wait up to 10 % **longer** than `WEBHOOK_BACKOFF_CAP_MS`, although the config says "no retry ever waits longer than this".
- **Why:** the test calls `backoffDelayMs(1, config)` with the default `Math.random` jitter; the code does `Math.round(min(raw, cap) * (0.9 + jitter*0.2))`.
- **What it breaks:** a red test hides real webhook regressions. With the default 6-hour cap, a late retry can wait up to 6 h 36 min, past the documented limit.

The base and the exponent are correct (attempt 1 = base, attempt n = base·2ⁿ⁻¹): "backoff differs from config" was only the jitter, plus the cap breach.

## 1. The issue

`dispatcher.test.ts` "failing endpoint: backoff/exhaustion sequence…" failed with `expected: 1000, actual: 916` (then 1019, 1006 on other runs — a different random value each time).

## 2. Why it happened — the root cause

`apps/api/src/webhooks/dispatcher.ts` (before):

```ts
const capped = Math.min(raw, config.webhookBackoffCapMs);
return Math.round(capped * (0.9 + jitter() * 0.2));   // up to 1.1 × cap
```

`apps/api/src/webhooks/dispatcher.test.ts` (before):

```ts
const expectedDelay1 = backoffDelayMs(1, config);   // random jitter
assert.equal(expectedDelay1, 1000);                  // exact value
```

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Developers / CI | One webhook test red on almost every run | Medium |
| Merchants | Late retries can arrive up to 10 % after the promised maximum wait | Low |
| FilsPay ops | Retry timing doesn't match the configured cap they tune | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/webhooks/dispatcher.ts` `backoffDelayMs` | Clamp to the cap again after jitter: `Math.min(Math.round(capped * (0.9 + jitter()*0.2)), cap)` |
| `apps/api/src/webhooks/dispatcher.test.ts` | The sequence test computes its expected value with a fixed jitter (`() => 0.5`, the midpoint = configured value); its real-delay check already has a ±3 s tolerance. New unit test pins jitter at 0/0.5/1 and checks the cap is never exceeded. |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Clamp after jitter + make the test pass a fixed jitter | Keeps jitter (avoids retry storms); honours the cap; deterministic test | At the cap, jitter is one-sided (−10 %..0) | ✅ |
| 2 | Remove jitter entirely | Exact, simple | All failed deliveries retry at the same moment (thundering herd) | |
| 3 | Only change the test to allow ±10 % | Smallest diff | Leaves the cap breach | |
| 4 (creative) | "Full jitter" (random between 0 and the capped delay) | Best spread, AWS-recommended | Changes retry behaviour merchants may rely on; attempt 1 could be ~0 ms | |

**Why we chose #1:** it fixes both the flaky test and the real cap breach in one line of production code, without changing normal retry timing.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `failing endpoint: backoff/exhaustion sequence…` | `apps/api/src/webhooks/dispatcher.test.ts` | ❌ `expected 1000, actual 916` (random) | ✅ (2 runs) |
| `backoffDelayMs: jitter stays within ±10 % … never exceeds the cap` (new) | same | ❌ `attempt 20 with jitter 0.999: 65988ms exceeds cap 60000ms` | ✅ |

Existing tests changed (and why): the sequence test now passes a fixed jitter when computing the *expected* delay — the old line encoded the wrong assumption that the delay is exact.
