# FP-300.5 (reports) — refunds counted in the daily rollup, analytics and exports

| | |
|---|---|
| **Severity** | Feature (missing) · ★★ |
| **Area** | Refunds (FP-300) · Reporting |
| **Analysis ID** | R6 (reporting part), §4 checklist item 8 |
| **Clue** | `runConsumerPass.ts` "am: refund.succeeded not here yet. when refunds ship just add it to the list"; unwired `applyDailySummaryRollup` in `applyEvent.ts` |
| **Owner** | Stream S6 |
| **Status** | ✅ done |

## Summary (the short note)

- **What was missing:** every merchant report showed sales as if no refund ever happened. The reporting
  worker never read `refund.succeeded`, so the daily volume rollup, the overview chart, the export summary and
  the transactions CSV all showed gross only.
- **Why:** `refund.succeeded` was not in `REPORTING_EVENT_TYPES` and `applyEvent` had no case for it.
- **Traps (the comment is wrong three ways):**
  1. "just add it to the list" — without a case in `applyEvent`'s switch, its `default` throws, the whole pass
     rolls back and **reporting stalls for every merchant** (same trap as the webhook dispatcher, FP-300.4).
  2. The ready-made `applyDailySummaryRollup` wrote to `refund_count` / `refund_gross_fils` — **columns that do
     not exist** on `merchant_daily_volume` (0027). Wiring it alone would fail every pass.
  3. It bucketed by `toISOString().slice(0, 10)` — the **UTC** date. A refund at 00:30 Bahrain time would land
     on the previous day. Captures use the Bahrain date; refunds now do too.
- **Payload check:** `processRefund` enqueues `{ merchantId, refundId, amountFils, feeReversedFils,
  refundedTotalFils, newStatus }`. The rollup sums `amountFils` (the per-refund delta), never
  `refundedTotalFils` (a running total — summing it would double-count).

## 4. The change

| File | Change |
|---|---|
| `db/migrations/0091_merchant_daily_volume_refunds.sql` | new: `refund_count`, `refund_gross_fils` on `merchant_daily_volume` (default 0) |
| `apps/reporting/src/consumer/applyEvent.ts` | `refund.succeeded` case → `applyRefundSucceeded` → `applyDailySummaryRollup` with the event's `amountFils`, Bahrain date |
| `apps/reporting/src/consumer/runConsumerPass.ts` | `refund.succeeded` added to `REPORTING_EVENT_TYPES` (after the case exists); misleading comment replaced |
| `apps/api/src/analytics/query.ts` | `GET /v1/analytics/volumes` points also return `refundCount`, `refundGrossFils` |
| `apps/api/src/routes/reporting.ts` | `GET /v1/reporting/export-summary` also returns `refundedFils` and `netFils` (gross − refunds) |
| `apps/api/src/transactions/exportCsv.ts` | CSV gets a last column `refunded_bhd` (3 decimals, from `refunded_fils`) — in both the buffered and streamed export |

Exactly once: the refund is applied inside the same transaction that moves the reporting watermark, the same
guarantee captures already have. `rebuild` replays through the same `applyEvent`, so it also restores refunds.

All additions are new fields / a new last column, so existing readers keep working.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | New columns + consumer case + list entry; expose in analytics/export | Same exactly-once path as captures; Bahrain day; one source for every report | One migration | ✅ |
| 2 | Only add to the list (the comment) | One line | Stalls all reporting (unhandled type, then missing columns) | |
| 3 | Reports read `refunds` table live (`SUM` by day) | No consumer change | Heavy query per request on a hot table; two sources of truth for "a day" | |
| 4 | Fix and use the `refund_merchant_summary` matview (0072) | Already exists | Wrong join (R7, `t.id = r.id`), nothing refreshes it, admin-only | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| `refund.succeeded (via applyEvent): … bucketed by Asia/Bahrain date` (22:30 UTC → next Bahrain day; two refunds sum to 2.000 BD) | `apps/reporting/src/consumer/applyEvent.test.ts` | ❌ "unhandled event_type refund.succeeded" | ✅ |
| `runConsumerPass: a refund.succeeded event is applied … exactly once` (two passes, count stays 1) | `apps/reporting/src/consumer/runConsumerPass.test.ts` | ❌ watermark never reached the refund | ✅ |
| `GET /v1/analytics/volumes: each day carries its refunds` | `apps/api/src/routes/analytics.test.ts` | ❌ (no field) | ✅ |
| `a refunded transaction shows its refunded amount in BD` (2005 fils → `2.005`) | `apps/api/src/transactions/exportCsv.test.ts` | ❌ | ✅ |
| reporting suite | `apps/reporting` | 13/13 | 15/15 |

**Existing tests changed (justified):** `exportCsv.test.ts` "builds a header…" — expected header and row now
include the new last column `refunded_bhd` (`0.000` for a non-refunded sale). `reporting.exportSummary.test.ts`
— expected object now includes `refundedFils` / `netFils`, and its fixture rows carry a 500-fils refund. Both
tests encoded the old "no refunds" shape, not a rule.

**Left open:** R7 (`0072` matview join) is not fixed here — nothing in the apps reads or refreshes that view.
