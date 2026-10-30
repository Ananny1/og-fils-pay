# BUG-088 — Closing today's batch from the admin console loses the rest of today's sales

| | |
|---|---|
| **Severity** | High (money: a shop is never paid for some sales) |
| **Area** | Admin settlement ops · Settlement batches |
| **Found** | Live test on 30 Oct: closed Alpha Retail's 30 Oct batch at 19:49 Bahrain time |
| **Status** | ✅ fixed |

## Summary

- **What a user sees:** a finance admin clicks *Run batch* for today. The batch closes and pays. Every
  card payment the shop takes later that same day never appears in any payout.
- **Why:** a batch claims only the capture events inside its own business day
  (`apps/settlement/internal/settlement/batch.go:159-160`:
  `te.settlement_batch_id IS NULL AND te.occurred_at >= $2 AND te.occurred_at < $3`). The next day's
  batch only looks at the next day. `POST /v1/admin/settlement/run-batch`
  (`apps/api/src/routes/admin.ts`) accepted any `YYYY-MM-DD`, including today and future dates.
- **Fix:** the route refuses a date whose Bahrain business day has not ended yet:
  `409 business_day_not_over`, before the audit row and before calling the settlement service.


**Present in the original code (8b58b0f):** `apps/api/src/routes/admin.ts:118` checked only the date format; `apps/settlement/internal/settlement/batch.go:154-155` claimed only `occurred_at >= day start AND < day end`.

## 1. The issue
Run batch for today → `200`, batch closed and paid. A capture at 20:30 the same day keeps
`settlement_batch_id = NULL` forever: the closed batch is a no-op on re-run, and later batches use later
windows. Refunds don't have this problem (they are claimed with `occurred_at < end of day`, carried forward).

## 2. Who is affected
Any merchant whose day a staff member closes early by hand. The nightly scheduler is safe: it only closes
days that have ended (+15 min delay).

## 3. The change
| File | Change |
|---|---|
| `apps/api/src/admin/businessDay.ts` (new) | `bahrainBusinessDate`, `businessDayStart`, `businessDayHasEnded` (UTC+3, no DST) |
| `apps/api/src/routes/admin.ts` | run-batch: `if (!businessDayHasEnded(date, now)) throw ConflictError("business_day_not_over")` |

## 4. Options considered
| Rank | Option | Chosen? |
|---|---|---|
| 1 | Refuse closing a running or future day at the API (the only caller of the internal endpoint) | ✅ |
| 2 | Also refuse in the Go internal API | Belt and braces; the internal API is token-only and called only by apps/api |
| 3 | Let later batches also claim earlier unbatched captures (like refunds) | Fixes stranding in general, but changes which batch a sale belongs to and the reconciliation windows |

## 5. Proof
| Test | Before | After |
|---|---|---|
| `admin.test.ts` "settlement run-batch refuses a Bahrain business day that is not over yet" (today and tomorrow) | `200`, settlement called | `409 business_day_not_over`, no call, no audit row |
| `businessDay.new.test.ts` (3 tests: day start 21:00 UTC, date flips at 21:00 UTC, 30 Oct ends at 21:00 UTC) | — | ✅ |

Data already affected: on a dev laptop only (Alpha Retail, 30 Oct). Any capture of that day after the
early close stays unbatched; it can be found with
`SELECT … FROM transaction_events WHERE settlement_batch_id IS NULL AND event_type IN ('captured','partially_captured') AND occurred_at < now() - interval '1 day'`.
