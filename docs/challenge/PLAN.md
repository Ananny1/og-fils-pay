# FilsPay — Work Plan

Every known issue, grouped into phases, in the order we fix them. Details for each ID are in
`ANALYSIS.md`. When a task is done: tick it here, fill the `IMPLEMENTATION.md` register and write
`docs/bugs/BUG-NNN-*.md`.

**Status:** ⬜ todo · ⏳ in progress · ✅ done · ⏭ skipped (say why)
**Points:** ★★★ critical (security / money lost or duplicated) · ★★ wrong money · ★ reliability / reporting

Paths are relative to the repo root. `api/` = `apps/api/src/`, `stl/` = `apps/settlement/internal/`.

---

## Phase 0 — Setup ✅

| Task | Status |
|---|---|
| Read the brief, sheets, docs, ADRs, history; decode the CTF flag | ✅ |
| Full audit → `ANALYSIS.md` | ✅ |
| Replace poisoned agent files, write `GUIDE.md`, `TRAPS.md`, `PLAN.md`, bug template | ✅ |
| Block `git push` for agents (`.claude/settings.json`) | ✅ |

## Phase 1 — Get it running locally (deploy blockers)

Without these we can't reproduce or test anything.

| ID | Bug # | Task | Files | Status |
|---|---|---|---|---|
| D1 | DEP-001 | Add the missing Dockerfiles (multi-stage; clean the Go build cache, the box has only 2 GB of disk) | `ops/Dockerfile.node`, `ops/Dockerfile.go`, `ops/docker-compose.yml` | ✅ |
| D3 | DEP-002 | Make a fresh `migrate` succeed: neutralise 0054 (`v_unbatched_capture_events` refers to a table that doesn't exist) | `db/migrations/0054_views.sql`, `db/migrate.ts` | ✅ |
| D2 | DEP-003 | Compose must load the service env (`env_file`), production mode, real secrets | `ops/docker-compose.yml`, `apps/api/src/config.ts` | ⬜ |
| — | — | Run `npm test` + `go test ./...`, record the baseline (what fails before we start) | — | ⬜ |

## Phase 2 — Security and double money ★★★

| ID | Bug # | Task | Files | Test idea | Status |
|---|---|---|---|---|---|
| A1 | BUG-001 | Login works **without the OTP** (pending session accepted) | `api/auth/sessions.ts`, `db/migrations/0058_live_sessions.sql` | pending cookie → 401 | ⬜ |
| A2 | BUG-002 | OTP bound to **another merchant's user** with the same email | `api/routes/auth.ts` (`findOtpRecipient`) | 2 merchants, same email → each logs into own | ⬜ |
| A6 | BUG-003 | Merchant A **cancels B's payment link** (IDOR) | `api/paymentLinks/cancel.ts`, `api/routes/paymentLinks*.ts` | A cancels B's link → 404 | ⬜ |
| P1 | BUG-004 | **Expired link payable** via client `submittedAt` (FP-187) | `api/paymentLinks/pay.ts`, its route | old `submittedAt` on expired link → 410 | ⬜ |
| P2 | BUG-005 | Link **charged twice** when capture takes > 60 s (incident 2026-05-14) | `api/paymentLinks/pay.ts`, new migration 0073+ | slow acquirer + 2nd payer → one charge | ⬜ |
| W2 | BUG-006 | Acquirer callbacks **not deduplicated** (FP-201) | `api/acquirer/callbacks.ts`, `api/routes/acquirerCallbacks.ts`, new migration | same callback twice → one note | ⬜ |
| W3/W4/W5 | BUG-007 | Callback signature **optional**, re-serialised, no freshness, outcome not validated | `api/webhooks/inboundVerify.ts`, `api/routes/acquirerCallbacks.ts` | no header → 401; tampered body → 401 | ⬜ |
| W6/W7 | BUG-008 | **Duplicate payout notifications + disbursements** (incident 2026-08-21) | `stl/settlement/payout_notify.go`, `api/webhooks/dispatcher.ts`, new migration | run twice / 2 replicas → one event, one disbursement | ⬜ |
| B6 | BUG-009 | `expire_holds` **deletes every hold** when nothing expired | `scripts/expire_holds.ts`, `scripts/lib/sqlFilter.ts` | nothing expired → 0 rows touched; status flipped, never deleted | ⬜ |
| A7/A8 | BUG-010 | Impersonation gives **owner powers** (must be read-only support) | `api/admin/impersonation.ts`, `api/auth/requireMerchantAuth.ts` | impersonated write → 403 | ⬜ |
| A3/A4 | BUG-011 | OTP attempts bypassable in parallel; OTP from `Math.random` | `api/routes/auth.ts`, `api/lib/random.ts` (+ admin OTP: `api/adminAuth/otp.ts`) | 20 parallel guesses → max N counted | ⬜ |
| A11 | BUG-012 | **Old API key still works** after rotation | `api/admin/apiKeys.ts`, `api/apiKeys/verify.ts`, `0056_api_keys_revoke_after.sql` | old key after rotation → 401 | ⬜ |
| A9 | BUG-013 | Credit **self-approval** (compares display names) | `api/admin/creditApproval.ts` | same admin, renamed → rejected | ⬜ |
| A5 | — | OTP returned in the login response / logs outside production | `api/config.ts` (`otpDevExpose`) | default false | ⬜ |

## Phase 3 — Money and settlement correctness ★★

| ID | Bug # | Task | Files | Test idea | Status |
|---|---|---|---|---|---|
| B2 | BUG-014 | CSV import **10× off** (4.75 → 0.475, 4.755 → 4.750) | `api/admin/adjustmentCsvParsing.ts`, `api/lib/decimal.ts` (fix the test that asserts the bug) | "4.75" → 4750, "4.755" → 4755 | ⬜ |
| S3 | BUG-015 | Scheme file **a few fils over** (rounds up instead of truncating) | `stl/settlement/scheme_export.go`, `0008`/`0050` migrations | 93.275 → "93.27" | ⬜ |
| S5 | BUG-016 | Split payouts **lose remainder fils** (Delta Marketplace) | `stl/splits/allocate.go`, `stl/splits/shares.go` | children sum == net exactly | ⬜ |
| B1 | BUG-017 | "Rebuild balances" button reads **scheme lines, not the ledger** (135K → 7K) | `stl/internalapi/server.go`, `stl/ledger/rebuild.go` | button == CLI result | ⬜ |
| S6 | BUG-018 | MDR recalculation **rewrites paid batches** | `stl/settlement/recalculate_mdr.go` | paid batch unchanged | ⬜ |
| S7 | BUG-019 | "Recompute statuses" clears `test_mode` → **test shops get paid** | `api/admin/merchantFlags.ts`, `api/admin/transactionStatusRecompute.ts` | test merchant stays test | ⬜ |
| S1 | BUG-020 | Daily close at **03:00 Bahrain** (UTC day used) | `stl/settlement/window.go`, `stl/scheduler/daemon.go` | 22:30 UTC → next Bahrain day | ⬜ |
| S2 | BUG-021 | Net payout via **float32** | `stl/settlement/payable.go` | 20,000.001 BD exact | ⬜ |
| S8 | BUG-022 | Platform volume counter **int32 overflow** | `stl/settlement/platform_volume.go`, new migration (BIGINT) | pass 2,147,483,647 fils | ⬜ |
| S9 | BUG-028 | Lifetime payout estimate **drifts** (REAL / float32) | `stl/settlement/payout_estimate.go`, new migration | many adds stay exact | ⬜ |
| B5 | BUG-027 | March sweep: **not idempotent**, UTC month, wrong account | `scripts/reconcile_march.ts` | run twice → one posting | ⬜ |
| B3 | BUG-029 | Adjustment import has **no double-submit guard** | `api/admin/adjustmentImport.ts`, new migration | same file twice → second rejected | ⬜ |
| S4 | — | Scheme residue never posted to `scheme_rounding_residue` (ADR-0002) | `stl/settlement/batch.go` | residue group per line | ⬜ |
| P3 | — | Capture fee ignores negotiated discount; settlement applies it | `api/payments/capture.ts`, `api/payments/discountAdjustment.ts` | ledger fee == batch fee | ⬜ |
| S12 | — | Split children without a balance row → payout is a no-op | `stl/balances/cache.go` | upsert | ⬜ |

## Phase 4 — Webhooks, reporting, exports ★

| ID | Bug # | Task | Files | Status |
|---|---|---|---|---|
| W1 | BUG-023 | Outbound webhook **signs different bytes than it sends** (FP-240) — Yousif's `ya/sign-raw` | `api/webhooks/dispatcher.ts`, `api/webhooks/sign.ts` | ⬜ |
| Q1 | BUG-024 | Settlement summary **double-counts** multi-capture merchants; slow | `api/settlement/query.ts`, new index migration | ⬜ |
| Q2/Q3 | BUG-025 | Export loads everything in memory; the streaming one **skips rows** | `api/transactions/exportCsv.ts`, `api/routes/transactions.ts` | ⬜ |
| Q5 | BUG-026 | Dashboard fee **245 vs 225 bps** (latest entered, not effective) | `api/fees/currentFeeScheduleDisplay.ts` | ⬜ |
| Q4 | BUG-030 | CSV export **formula injection** | `api/transactions/exportCsv.ts` | ⬜ |
| Q6 | — | Reconciliation uses `merchants.mdr_bps` (no sync trigger exists) | `api/settlement/query.ts` | ⬜ |
| Q7/P4/Q8 | — | Rollups / metrics / analytics bucketed by **UTC date** | `apps/reporting/src/consumer/applyEvent.ts`, `api/payments/capture.ts`, `api/analytics/query.ts` | ⬜ |

## Phase 5 — FP-300 Refunds end to end ★★★

Fixes R1–R9 along the way. Open questions: **Q-1** route path, **Q-2** how refunds reduce the next batch.

| Step | Task | Files | Status |
|---|---|---|---|
| 1 | Route + guards + required `Idempotency-Key` | `api/routes/*refund*` / `api/v1/routes/transactions.ts`, `apps/web/src/api/transactions.ts` | ⬜ |
| 2 | One transaction, `FOR UPDATE`, scoped to merchant (R1 race, R3 IDOR) | `api/payments/processRefund.ts` | ⬜ |
| 3 | Refundable = **captured** − refunded (R2) | `api/payments/refundValidation.ts` | ⬜ |
| 4 | Fee reversal never above the original fee in total (R4) | `packages/money` `calculateRefundFee` | ⬜ |
| 5 | Correct status after full refund (R5) | `api/payments/refundState.ts` | ⬜ |
| 6 | Ledger legs balance to the fil | `api/payments/processRefund.ts` | ⬜ |
| 7 | Next batch net goes down by the refund (R9) | `stl/settlement/batch.go`, new migration | ⬜ |
| 8 | `refund.succeeded` webhook: envelope case first, then the list (R6) | `api/webhooks/envelope.ts`, `api/webhooks/dispatcher.ts` | ⬜ |
| 9 | Timeline + `RefundDrawer` wired | `apps/web/src/pages/transactions/RefundDrawer.tsx`, `TransactionDetailPage.tsx` | ⬜ |
| 10 | Reports + reconciliation (0072 join R7, 0070 constraint R8) | `apps/reporting/src/consumer/applyEvent.ts`, `api/settlement/query.ts`, new migration | ⬜ |
| 11 | Tests: parallel refunds, over-refund, cross-merchant, partial fee sums | new `*.test.ts` | ⬜ |

## Phase 6 — Deploy and hand in

| ID | Task | Status |
|---|---|---|
| D4 | Rotate the acquirer secret leaked in the reference history | ⬜ |
| D5 | Don't publish Postgres / internal API ports; real passwords | ⬜ |
| D7 | `readyz` checks the DB | ⬜ |
| — | Deploy to Dilmune Cloud (Q-4: access details) | ⬜ |
| — | Final pass on `IMPLEMENTATION.md` and `docs/bugs/` | ⬜ |

## If time allows (low points)

A10 admin replay/archive role check · A12 API keys bypass role gates (documented) · A13 admin
session fixation · B4 "Adjust balance" is cache-only · S10 daemon closes on boot · S11 rebuild vs
CloseBatch race · W8 replay keeps delivery ids? · W9 timestamp check order.
