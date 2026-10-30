# FP-301 — "Payout days" panel in the admin console

| | |
|---|---|
| **Type** | Feature (ops safety) |
| **Area** | Admin settlement ops (`apps/admin`, `apps/api`) |
| **Status** | ✅ done |

## Summary
Closing a payout day by hand meant typing a date and a 36-character merchant id into a form, with
nothing telling you which days needed it. That is how a running day got closed early (BUG-088).
The Settlement ops page now opens with the last 7 Bahrain business days and what each one needs.

| Status | Meaning | Action |
|---|---|---|
| Still running | today; still taking payments | none ("After midnight") |
| Not closed | over, and has sales no batch has claimed (the nightly job missed it) | **Close & pay** (confirm) |
| Closed, not paid | batches closed but not all paid | **Close & pay** (re-run is idempotent) |
| Paid | nothing waiting, every batch paid | none |

Columns: waiting-to-be-paid amount and shop count, shops paid / batches, gross, fee, net.

## The change
| File | Change |
|---|---|
| `apps/api/src/admin/settlementDays.ts` | `listSettlementDays`: two grouped queries bounded to the 7-day range (batches by `batch_date`; unclaimed capture events by Bahrain day via the partial index `idx_transaction_events_unbatched`); `dayStatus` rule |
| `apps/api/src/routes/admin.ts` | `GET /v1/admin/settlement/days` (finance, super_admin) |
| `db/migrations/0099_settlement_batches_date_index.sql` | index on `settlement_batches(batch_date)` so the date-range query doesn't scan the table |
| `apps/admin/src/pages/settlement/PayoutDaysPanel.tsx`, `SettlementPage.tsx`, `api/settlement.ts`, `types.ts` | the panel; Close & pay calls the existing audited run-batch for that date (all merchants); the manual form's default date is now yesterday in Bahrain, not in the browser's timezone/UTC |

## Proof
| Test | Result |
|---|---|
| `settlementDays.new.test.ts` (status rules) | ✅ 4 |
| `admin.test.ts` "settlement days…" (7 days, newest first, today running; support → 403) | ✅ |
| BUG-088 tests (running day refused) | ✅ |
