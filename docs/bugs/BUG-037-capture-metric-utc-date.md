# BUG-037 — Capture's daily-volume metric bucketed by UTC date (dead code)

| | |
|---|---|
| **Severity** | Low (latent — the code was never called) |
| **Area** | Reporting |
| **Analysis ID** | P4 (see `docs/challenge/ANALYSIS.md`) |
| **Clue** | `capture.ts` `recordCaptureMetric`: `capturedAt.toISOString().slice(0, 10)` |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-037` |
| **Status** | ✅ fixed (removed) |

## 1. The issue — what was wrong

The audit (P4) said capture's daily-volume metric is bucketed by UTC date instead of the Bahrain
business day. The bucketing really is wrong (a capture at 22:30 UTC = 01:30 Bahrain next day would
land on the previous day). But on checking, **the function is never called**: nothing in `apps/`,
`packages/` or `scripts/` references `recordCaptureMetric`. So no wrong numbers reached a dashboard
from this code today. It is a trap waiting for the next person who "wires the metric back in".

## 2. Why it happened — the root cause

```ts
// apps/api/src/payments/capture.ts (before), never called
async function recordCaptureMetric(client, merchantId, amountFils, capturedAt) {
  const dateStr = capturedAt.toISOString().slice(0, 10);   // UTC calendar day
  ... INSERT/UPDATE merchant_daily_volume ...
}
```

`merchant_daily_volume` is owned by the reporting consumer: `apps/reporting/src/consumer/applyEvent.ts`
consumes the `transaction.captured` outbox event that capture already enqueues and buckets it with
`toBahrainDateString(created_at)`. If capture also wrote the table, every capture would be counted
**twice**, and the capture-side half on the UTC day.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Nobody today (dead code). If wired: daily volume doubled and 21:00–24:00 UTC sales on the wrong day | Latent |
| FilsPay | Same; analytics vs settlement day mismatch | Latent |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/payments/capture.ts` | dead `recordCaptureMetric` removed; short comment explains why and points to the reporting consumer |

Removing it is smaller and safer than "fixing" the date: the correct, Bahrain-day bucketing already
exists in exactly one place (the reporting consumer), and the table must have one writer.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Delete the unused function | One writer for the table; no wrong-day code left | None | ✅ |
| 2 | Keep it, switch to `toBahrainDateString` | Matches P4's suggestion literally | Still dead code; wiring it would double-count | |
| 3 | Wire it in with the Bahrain date | Real-time metric | Double-counts with the consumer | |

## 6. Proof

There is no behaviour to test — the function had no caller. Proof is the reference search plus the
type-check:

```bash
grep -rn "recordCaptureMetric" apps packages scripts   # before: only its own definition; after: only the comment
cd apps/api && npx tsc --noEmit                         # passes
```

The existing reporting tests (`apps/reporting/src/consumer/applyEvent.test.ts`, "bucketed by
Asia/Bahrain date") cover the real writer. Existing tests changed: none.
