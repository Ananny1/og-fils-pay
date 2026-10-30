# FilsPay — Findings report

**Team:** Ebrahim and Sayed · **Date:** 2026-10-30 · **Repo branch:** `ebrahim/track-b`

This report explains the **root cause of every problem we found** in FilsPay: the bugs, the deploy
blockers and the poisoned AI instructions. It covers the ones we fixed and the ones we did not have
time to fix. Each fixed one has a full write-up in `docs/bugs/` with the failing test, the fix and
the proof.

How to read a row:

- **Severity:** Critical = security hole, or money lost or paid twice · High = wrong money or a
  broken flow · Medium = reliability, reporting or hygiene.
- **Root cause:** the code mechanism, in plain words, with `file` → `function`.
  Paths are from the repo root; `api/` = `apps/api/src/`, `stl/` = `apps/settlement/internal/`.
- **Status:** ✅ fixed (with a test) · ⏳ being fixed in the sprint (stream in brackets) ·
  ⬜ not fixed, root cause documented · ⏭ not a bug / reclassified (reason given).
  *Status is the only column that changes; it follows `docs/challenge/PLAN.md` → Master order.*

---

## 1. Summary

### Counts per area and severity

| Area | Critical | High | Medium | Total |
|---|---|---|---|---|
| A. Login and access | 5 | 5 | 1 | 11 |
| B. Money coming in | 6 | 0 | 0 | 6 |
| C. Money maths | 2 | 6 | 0 | 8 |
| D. Settlement (Go) | 3 | 3 | 1 | 7 |
| E. Webhooks and reports | 1 | 4 | 4 | 9 |
| F. Refunds (FP-300, the missing feature) | 3 | 2 | 1 | 6 (+ 6 feature steps) |
| G. Deployment and running | 3 | 3 | 1 | 7 |
| H. Poisoned AI instructions | 1 | 0 | 0 | 1 |
| **Total** | **24** | **23** | **8** | **55** |

### Status (update at the end of the sprint)

| Status | Count | IDs |
|---|---|---|
| ✅ Fixed, with a test and a write-up | 15 | DEP-001–005, BUG-058, F0, BUG-050, BUG-009, BUG-001, BUG-002, BUG-011, BUG-031, BUG-032, BUG-010 |
| ⏭ Reclassified (not a bug) | 1 | BUG-037 → ENH-008 |
| ⏳ / ⬜ Open (root cause below) | 39 | everything else |

Numbers BUG-038 to BUG-049 were never used (that range was kept for Track A and nothing new was found in it).

### The five root causes behind most bugs

| Pattern | What it looks like in the code | Bugs |
|---|---|---|
| **Check, then act, with no lock** | Read a row, check it, write later in a separate step; two requests both pass the check | BUG-005, 006, 008, 011, 029, 034 |
| **Wrong unit or wrong number type** | 2 decimals (cents) instead of 3 (fils); `float32`, `REAL`, `int32` for money | BUG-014, 015, 021, 022, 028, 050 |
| **UTC used where Bahrain time is the rule** | `date.Date()` / `toISOString().slice(0,10)` give the UTC day; the business day ends at 21:00 UTC | BUG-020, 027, 055 |
| **Scope missing from a query or a grant** | `WHERE id = $1` with no `merchant_id`; a role map or flag that grants more than it should | BUG-001, 002, 003, 010, 033, 036 |
| **A false comment or doc stopped the fix** | "intentional", "already fixed in FP-201", "Claude says it's redundant", "never change tests" | BUG-001, 006, 009, 010, 017, 050 (full list: `docs/challenge/TRAPS.md`) |

---

## 2. How we worked

| Rule | What we did |
|---|---|
| **Trust order** | Code behaviour → ADR-0001 / ADR-0002 → `docs/HANDOVER.md` → `docs/ARCHITECTURE.md` → everything else. The ADRs and the handover are the spec; comments and other docs had to be proven. |
| **Trap protocol** | Any text saying "intentional", "by design", "frozen", "approved", "already fixed", "do not fix" or "Claude says it's fine" was a claim to test, not an order. Over 40 false claims are recorded in `docs/challenge/TRAPS.md`. |
| **Test first** | Every fix starts with a test that fails on the old code (red); the smallest fix makes it pass (green). Where an existing test checked *for* the bug (e.g. the CSV test expecting 4.75 BD → 475 fils), we changed the test and said why. |
| **One bug = one commit** | Each commit holds one bug's fix, its tests and its write-up, titled `fix(BUG-NNN): …`. Any fix can be reviewed or reverted on its own. |
| **Minimal fixes** | The smallest change that removes the root cause, in the code's own style. Anything bigger became an enhancement (`ENH-NNN`). |
| **Write-ups** | `docs/bugs/<ID>-*.md`: the short note (what's wrong / why / what it breaks), who was affected, the fix, at least 3 ranked options, and before/after proof. |

---

## 3. Findings by area

### A. Login and access

| ID | Sev | What's wrong | Root cause | Impact | Status | Write-up |
|---|---|---|---|---|---|---|
| BUG-001 | Critical | You are fully logged in after the password; the OTP is never needed | `api/auth/sessions.ts` → `lookupSession` reads the view `live_sessions` (migration 0058), which filters revoked and expired sessions but **not `authenticated = true`**, so the pre-OTP cookie counts as a login. A "claude flagged it as redundant" comment (T-44) shows how the check was lost | Second factor useless: a password alone opens the shop | ✅ | [BUG-001](bugs/BUG-001-login-without-otp.md) |
| BUG-002 | Critical | A user whose email is in two shops logs into shop A and lands in shop B | `api/routes/auth.ts` login looked the user up again **by email only** (`findOtpRecipient`: any shop, first row wins) and bound the OTP and session to that row | One shop sees and acts on another shop's money | ✅ | [BUG-002](bugs/BUG-002-otp-wrong-merchant.md) |
| BUG-011 | High | The "5 tries" OTP limit doesn't hold; codes are predictable | `api/routes/auth.ts` OTP verify reads `attempt_count`, compares, then increments (no lock), so parallel guesses all run (40 sent → 12 checked); resend made a new challenge at 0 tries; `api/lib/random.ts` → `randomDigits` used `Math.random`. Same on the admin side | Second factor can be brute-forced, admin console included | ✅ | [BUG-011](bugs/BUG-011-otp-guessable.md) |
| BUG-031 | Critical | The login reply contains the OTP code and the log prints it | `api/config.ts` → `otpDevExpose` defaults to on whenever `NODE_ENV !== "production"`, and compose never set `NODE_ENV` (DEP-003); the log used a second switch with the same default; production could still turn it on | Anyone with a password reads the code from the reply | ✅ | [BUG-031](bugs/BUG-031-otp-exposed-in-reply-and-logs.md) |
| BUG-032 | High | The cookie from the password step becomes the full login; the shop cookie dies after 10 min | OTP verify in `api/routes/auth.ts` and `api/routes/adminAuth.ts` only flags the session row `authenticated`; the token is never replaced (session fixation) and the merchant cookie keeps the 10-minute pending lifetime | Anyone who saw the pre-OTP cookie is logged in once the real user finishes the OTP | ✅ | [BUG-032](bugs/BUG-032-session-fixation.md) |
| BUG-010 | Critical | "View as shop" gives a super_admin the **owner's** powers, and every admin can write | `api/admin/impersonation.ts` → `MERCHANT_ROLE_FOR_ADMIN_ROLE` maps `super_admin → owner`, `finance → finance` (spec: every grant is `support`, read-only); `api/auth/requireMerchantAuth.ts` never blocks writes on an impersonation grant | Staff create links, capture or void a shop's payments, recorded as the shop's own action | ✅ | [BUG-010](bugs/BUG-010-impersonation-owner-and-writes.md) |
| BUG-003 | Critical | Shop A can cancel shop B's payment link | `api/paymentLinks/cancel.ts` selects and updates the link `WHERE id = $1` only; the route checks the merchant in the URL, not who owns the link (IDOR) | Any shop can cancel any other shop's links | ⏳ (S1) | |
| BUG-033 | High | Some admin actions have no role check | In `api/routes/adminMerchants.ts` the write routes webhook replay-batch, archive create, archive replay (and one more POST) have only `requireAdminSession`, no `requireAdminRole(...)`, while KYC review and key rotation next to them do; so any `support` admin can re-sign and resend money events. The full audit of every `/v1/admin` route is S1's task | Least privilege broken on the admin console | ⏳ (S1) | |
| BUG-012 | High | After an API key rotation the old key still works | `api/admin/apiKeys.ts` → `rotateApiKeyAsAdmin` issues a new key and never touches the old row; `revoke_after` (migration 0056) is never set, and `api/apiKeys/verify.ts` never checks it | A leaked key can't be killed by rotating it | ⏳ (S1) | |
| BUG-013 | High | One admin can approve their own credit | `api/admin/creditApproval.ts` compares the requester's and approver's **display names**, not their admin user ids (HANDOVER: "compared by admin user id") | Two-person control bypassed by renaming yourself | ⏳ (S1) | |
| BUG-037 | Medium | Public signup accepts an existing user's email | `api/onboarding/signup.ts` doesn't verify email ownership; dangerous only together with BUG-002 | After BUG-002 the takeover path is closed; shared emails across shops are legitimate | ⏭ → ENH-008 (D-015) | |

### B. Money coming in

| ID | Sev | What's wrong | Root cause | Impact | Status | Write-up |
|---|---|---|---|---|---|---|
| BUG-004 | Critical | An expired payment link can still be paid (FP-187) | `api/paymentLinks/pay.ts` → `expiryReferenceTime` compares the expiry to the **`submittedAt` sent by the browser**; the public route passes it through, so a client can send an old time | Customers charged on links the shop thinks are dead | ⏳ (S2) | |
| BUG-005 | Critical | One payment link charged twice (incident 2026-05-14) | `api/paymentLinks/pay.ts` claim/finalize: the link reservation expires after 60 s while authorize + capture is still running, so a second payer re-claims it; the first finalize then updates 0 rows but still returns 200. The "unique capture guard" (FP-202) never existed | Double charge on single-use links | ⏳ (S2) | |
| BUG-007 | Critical | Acquirer callback signature can be skipped or faked | `api/webhooks/inboundVerify.ts`: a missing signature header is accepted unless `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE=true` (default false); it verifies `JSON.stringify(parsed)` instead of the raw body; no timestamp freshness; `Buffer.compare` instead of `timingSafeEqual`. `api/routes/acquirerCallbacks.ts` never validates `outcome` | Anyone can post a fake "payment succeeded" callback | ⏳ (S3) | |
| BUG-006 | Critical | Duplicate acquirer callbacks saved twice (FP-201 "fixed", reopened) | `api/acquirer/callbacks.ts` inserts every callback; there is no `processed_events` table and no unique index on `acquirer_callback_notes(callback_id)` (migration 0051), whatever the docs say (T-31, T-32) | The same payment event is applied twice | ⏳ (S3) | |
| BUG-008 | Critical | Duplicate payout notifications and disbursements (incident 2026-08-21) | `stl/settlement/payout_notify.go` → `EnqueuePayoutNotifications` checks "NOT EXISTS" then inserts (no unique index, though a comment says one exists); `api/webhooks/dispatcher.ts` → `PRE_DELIVERY_EFFECTS` writes a disbursement row per delivery (per endpoint, per replica) with no unique key; deliveries are not claimed with `FOR UPDATE SKIP LOCKED` | Shops told twice they were paid; disbursements recorded twice | ⏳ (S3) | |
| BUG-009 | Critical | The cleanup script deleted every card hold on a quiet night | `scripts/expire_holds.ts` built its filter with `scripts/lib/sqlFilter.ts` → `buildWhere`; an **empty** list of expired ids dropped the filter, so it ran `DELETE FROM holds` with no `WHERE`. It also deleted instead of flipping the status (HANDOVER: holds are never deleted) | All records of reserved card money gone | ✅ | [BUG-009](bugs/BUG-009-expire-holds-deletes-all.md) |

### C. Money maths

| ID | Sev | What's wrong | Root cause | Impact | Status | Write-up |
|---|---|---|---|---|---|---|
| BUG-014 | Critical | CSV import reads 4.75 BD as 0.475 BD, and 4.755 as 4.750 | `api/admin/adjustmentCsvParsing.ts` parses with `api/lib/decimal.ts` → `parseDecimalMinor(raw, 2)`: **2 decimals (cents) and truncation**, instead of `parseBhdToFils` (ADR-0001). An existing test asserted the wrong value (475) | Imported adjustments 10× too small; fils lost | ⏳ (S4) | |
| BUG-017 | Critical | "Rebuild cached balances" turns 135K BD into 7K BD (FP-203) | `stl/internalapi/server.go` → `handleRebuildBalances` calls `ledger.RefreshBalanceCache`, which reads the view `merchant_payable_position` = sum of **scheme export lines** (gross only, no fees, no payouts), not the ledger. ADR-0004 justified it; HANDOVER says only the ledger is valid | Shops shown a wrong balance | ⏳ (S4) | |
| BUG-021 | High | Net payout computed in `float32` | `stl/settlement/payable.go` → `NetPayableFils` goes through `float32` (about 7 digits), so amounts above ~16,777 BD lose fils | Wrong payouts for large shops | ⏳ (S5) | |
| BUG-022 | High | Platform volume counter overflows | `stl/settlement/platform_volume.go` uses `int32` and migration 0049 an `INTEGER` column; it wraps past 2,147,483,647 fils (~2.1M BD), right next to the 2,000,000,000 tier threshold | Volume tiers and fees go wrong for large volume | ⏳ (S5) | |
| BUG-028 | High | Lifetime payout estimate drifts | `stl/settlement/payout_estimate.go` adds in `float32`, stored in a `REAL` column (migration 0040) | The estimate finance sees drifts from the truth | ⬜ (dropped in sprint) | |
| BUG-027 | High | March sweep doubled the gap when it ran twice | `scripts/reconcile_march.ts` uses a random `entry_group` per run and no "already done" marker (the RUNBOOK claims a description check, T-36); it uses the **UTC** month, and debits `merchant_payable` instead of `card_scheme_clearing` (ADR-0002) | Ledger corrections posted twice, to the wrong account | ⏳ (S4) | |
| BUG-029 | High | Adjustment import has no double-submit guard | `api/admin/adjustmentImport.ts` has no idempotency key or unique content hash, so the same file sent twice is applied twice | Double click = double money | ⏳ (S4) | |
| BUG-052 | High | Capture fee ignores the negotiated discount that settlement applies | `api/payments/capture.ts` computes the fee without `api/payments/discountAdjustment.ts` (applied only on the transactions route), while Go `ComputeSettlementFee` applies discount then MDR | Ledger fee ≠ batch fee; ledger and settlement never tie out | ⬜ (dropped in sprint) | |

### D. Settlement (Go)

| ID | Sev | What's wrong | Root cause | Impact | Status | Write-up |
|---|---|---|---|---|---|---|
| BUG-020 | High | Daily close happens at 03:00 Bahrain, not midnight | `stl/scheduler/daemon.go` → `runIfDue` and `stl/settlement/window.go` → `BusinessDayWindow` call `date.Date()` on a UTC time, so "today" flips at 00:00 UTC = 03:00 Bahrain. The "claude says this is a bug" comment there is right (T-34) | Payments made 00:00–03:00 Bahrain land in the wrong day | ⏳ (S5) | |
| BUG-015 | High | Scheme statement always a few fils over | `stl/settlement/scheme_export.go` → `SchemeAmountBD` stores `gross/1000` as a float in `scheme_export_lines.amount NUMERIC(10,2)`; Postgres **rounds** (93.275 → 93.28) while `amount_fils` truncates, and the file is built from `amount` | Scheme file never matches; a few fils over every day | ⏳ (S5) | |
| BUG-051 | High | Scheme rounding residue never posted | ADR-0002 says `CloseBatch` posts the per-line residue to `scheme_rounding_residue`; `stl/settlement/batch.go` has no such posting | `card_scheme_clearing` never clears to zero | ⬜ (dropped in sprint) | |
| BUG-016 | Critical | Delta Marketplace split payouts lose fils | `stl/splits/allocate.go` / `shares.go` round each child's share with `ApplyRateFils(net, weight)` on its own; the leftover fils stay in the parent's payable and are never paid | Sub-merchants paid short every batch | ⏳ (S5) | |
| BUG-053 | Medium | Split child without a balance row gets nothing | `stl/balances/cache.go` → `ApplyPayout` runs `UPDATE merchant_balances` only; with no row, 0 rows change and no error is raised | Payout silently skipped for new children | ⬜ (dropped in sprint) | |
| BUG-018 | Critical | MDR recalculation rewrites batches that were already paid | `stl/settlement/recalculate_mdr.go` selects batches with `status <> 'open'`, which includes `paid`, and updates their `fee_fils` / `net_payout_fils` | Paid history changes after the money left | ⏳ (S4) | |
| BUG-019 | Critical | Test merchants get paid in the real settlement run | `api/admin/merchantFlags.ts` → `reconcileSandboxFlag` (run by "Recompute transaction statuses") clears `test_mode` when `openAuthorizations == 0`, which is **always** 0 because its query excludes `authorized` | Test shops receive real payouts | ⏳ (S4) | |

### E. Webhooks and reports

| ID | Sev | What's wrong | Root cause | Impact | Status | Write-up |
|---|---|---|---|---|---|---|
| BUG-023 | Critical | Shops can't verify our webhook signatures (FP-240) | `api/webhooks/dispatcher.ts` signs `canonicalJson(payload)` (sorted keys, `api/webhooks/sign.ts`) but sends `JSON.stringify(row.payload)` (jsonb key order): **different bytes**. Yousif's `ya/sign-raw` branch, named by the hidden flag, had the fix | Shops reject every webhook, or stop checking signatures | ⏳ (S7) | |
| BUG-059 | High | Reporting consumer writes `merchant_id = NULL` (4 reporting tests red) | `apps/reporting/src/consumer/applyEvent.ts` takes `payload.merchantId` from the outbox event without checking it; one event without it makes the insert into `merchant_daily_volume` fail and stops the pass. Exact producer being confirmed by S7 | Dashboards and rollups stop updating | ⏳ (S7) | |
| BUG-060 | Medium | Webhook retry delay differs from the config (1 API test red) | `api/webhooks/dispatcher.ts` → `backoffDelayMs` applies ±10 % jitter from `Math.random` by default, so attempt 1 waits 900–1100 ms while the test expects the configured base (1000 ms). Being confirmed by S7 | Retry timing is not what operators configured | ⏳ (S7) | |
| BUG-030 | Medium | CSV export formula injection | `api/transactions/exportCsv.ts` → `csvEscape` quotes commas but doesn't neutralise cells starting with `= + - @` | A crafted reference runs as a formula in finance's spreadsheet | ⏳ (S7) | |
| BUG-026 | High | Dashboard shows 245 bps, the shop is charged 225 bps | `api/fees/currentFeeScheduleDisplay.ts` picks the fee schedule `ORDER BY created_at DESC` (last entered, e.g. a back-dated backfill) instead of the one with `effective_from <= now()` used for charging | Shops see a fee they don't pay | ⏳ (S7) | |
| BUG-024 | High | Settlement summary double-counts and is slow | `api/settlement/query.ts` → `getSettlementSummary` joins transaction events and sums `t.captured_fils` (a running total) once **per event**; no index on `transaction_events(transaction_id, event_type)` | Multi-capture shops over-reported (~+38 %) | ⬜ (dropped in sprint) | |
| BUG-025 | High | Large export loads everything in memory; the streaming version skips rows | `api/routes/transactions.ts` calls `buildTransactionsExportCsv` (one big string in a 512 MB container; CHANGELOG claims streaming). `streamTransactionsExportCsv` pages with `occurred_at >` only, so rows sharing a timestamp at a page edge are skipped | Big exports crash the API, or silently miss rows | ⬜ (dropped in sprint) | |
| BUG-054 | Medium | Reconciliation uses a stale fee rate | `api/settlement/query.ts` estimates pending fees with `merchants.mdr_bps`; migration 0046 says a trigger keeps it in sync, but no trigger exists (T-37) | Reconciliation doesn't tie out after a fee change | ⬜ (dropped in sprint) | |
| BUG-055 | Medium | Rollups, metrics and analytics bucketed by UTC date | `toISOString().slice(0,10)` in `api/payments/capture.ts` (`recordCaptureMetric`) and in the reporting refund rollup; `getFullYear` (server time zone) in `api/analytics/query.ts` | Late-evening activity counted on the wrong Bahrain day | ⬜ (dropped in sprint) | |

### F. Refunds — FP-300, the missing feature

FP-300 is the feature the brief asks us to finish: `POST /v1/refunds` returns 501, the refund drawer
is hidden, `refund.succeeded` is never sent, and settlement ignores refunds. The helpers that exist are buggy:

| ID | Sev | What's wrong | Root cause | Impact | Status | Write-up |
|---|---|---|---|---|---|---|
| BUG-061 | High | Every refund insert fails (11 refund tests red) | Migration 0070 adds `chk_refunds_reason_not_null`; `api/payments/processRefund.ts` inserts `reason ?? null` | No refund can be saved at all | ⏳ (S6) | |
| BUG-034 | Critical | Two refunds at once both succeed (FP-209) | `api/payments/processRefund.ts` validates in transaction 1 without `FOR UPDATE`, calls the acquirer outside it, then writes in transaction 2 **without re-checking**; `refunded_fils = prepared + amount` is a lost update | Customer refunded twice; shop loses money | ⏳ (S6) | |
| BUG-035 | Critical | You can refund more than was captured | `refundableFils = amount_fils (authorized) − refunded` instead of `captured_fils − refunded` | Refunds of money that was never taken | ⏳ (S6) | |
| BUG-036 | Critical | A shop can refund another shop's transaction | `processRefund` selects `WHERE id = $1`; `initiateMerchantRefund` uses the transaction's own `merchant_id` and never compares it to the caller | Cross-shop refunds | ⏳ (S6) | |
| BUG-056 | High | Fee reversal over partial refunds can exceed the original fee | `packages/money` → `calculateRefundFee` rounds each partial on its own (fee 2 on 3 fils; three 1-fil refunds reverse 3) instead of `round(fee × totalRefunded / captured) − alreadyReversed` | Platform hands back more fee than it earned | ⏳ (S6) | |
| BUG-057 | Medium | Wrong status after a full refund of a partial capture | `api/payments/refundState.ts` → `nextStatusAfterRefund` returns `partially_captured` whenever captured < authorized, **before** it looks at the refunded total; finance's rule ("refunded when every fils we captured went back", FH comment) is never reached | Timeline and reports show the wrong state | ⬜ (dropped in sprint) | |

Feature steps (not bugs, listed so nothing is missed):

| Step | What it needs | Root cause of the gap | Status |
|---|---|---|---|
| FP-300.1 | Refund route + guards + required `Idempotency-Key` | The route is a 501 stub; the drafted handler generated its own idempotency key, which protects nothing against a double click | ⏳ (S6) |
| FP-300.2 | Ledger legs balance to the fil | Depends on BUG-034 / 035 / 036 | ⏳ (S6) |
| FP-300.3 | Next settlement batch reduced by refunds | Go `CloseBatch` never claims refunds (`refunds.settlement_batch_id` unused) | ⬜ (if time) |
| FP-300.4 | `refund.succeeded` webhook | No envelope case in `api/webhooks/envelope.ts`, not in the dispatcher's list; the reporting consumer throws on unknown event types | ⏳ (S6) |
| FP-300.5 | Timeline, reports, reconciliation | Migration 0072 joins `t.id = r.id` (should be `r.transaction_id`); reconciliation ignores refunds | ⬜ (if time) |
| FP-300.6 | End-to-end refund tests | — | ⬜ (if time) |

### G. Deployment and running

| ID | Sev | What's wrong | Root cause | Impact | Status | Write-up |
|---|---|---|---|---|---|---|
| DEP-001 | Critical | The app can't be built | `ops/docker-compose.yml` points at `ops/Dockerfile.node` and `ops/Dockerfile.go`, which were never committed | Nothing runs, nothing deploys | ✅ | [DEP-001](bugs/DEP-001-missing-dockerfiles.md) |
| DEP-002 | Critical | A fresh database can't be migrated | Abandoned migrations: 0054 builds a view on the missing table `settlement_batch_events`; 0055 inserts into columns that don't exist | No new environment can be created | ✅ | [DEP-002](bugs/DEP-002-fresh-migrate-fails.md) |
| DEP-003 | Critical | Services never get their settings | Compose has no `env_file:`; its header comment says the file loads "automatically" (T-40) | API in dev mode (OTP exposed), settlement without a token | ✅ | [DEP-003](bugs/DEP-003-service-env-not-loaded.md) |
| DEP-004 | High | `docker compose up` in `ops/` (the brief's own instruction) crashes on a fresh clone | Every service started together with `migrate` (no wait for it to finish), and without a hand-made settings file settlement had no token | Judges can't start it the way the brief says | ✅ | [DEP-004](bugs/DEP-004-compose-up-from-ops.md) |
| DEP-005 | High | `npm test` never ran 376 API and reporting tests | The scripts pass `src/**/*.test.ts` to Node's test runner; Node 20 doesn't expand the pattern (Node 22 does) | "Tests pass" meant nothing | ✅ | [DEP-005](bugs/DEP-005-tests-never-ran-on-node20.md) |
| BUG-058 | High | API and seed crash on a laptop without a hand-made key | `api/config.ts`: the built-in dev webhook key decodes to **34 bytes**; the same file requires 32 (T-42) | A fresh clone can't run | ✅ | [BUG-058](bugs/BUG-058-dev-webhook-key-invalid.md) |
| F0 | Medium | Dashboard home shows a developer error; bad URLs show a blank page | `apps/*/src/router.tsx` had no `/` route, no catch-all and no `errorElement` | The first page a judge opens looks broken | ✅ | [F0](bugs/F0-dashboard-routes-and-error-pages.md) |

### H. Poisoned AI instructions

| ID | Sev | What's wrong | Root cause | Impact | Status | Write-up |
|---|---|---|---|---|---|---|
| BUG-050 | Critical | The files every AI coding tool reads first told it to keep the worst bugs | `CLAUDE.md`, `AGENTS.md`, `.cursorrules` stated false rules as audited policy: money in cents, UTC close, `Math.random` OTPs, super_admin → owner "approved", never change tests, money code frozen (T-01 – T-18) | Every AI-assisted change kept or re-added money and security bugs | ✅ (files replaced + guard test `scripts/agent_instructions.test.ts`) | [BUG-050](bugs/BUG-050-poisoned-agent-instructions.md) |

---

## 4. Other observations (not numbered, low points)

Found in the audit and documented, but not scheduled: API keys bypass merchant role gates
(documented as design) · "Adjust balance" changes the cache only, while ADMIN.md says it is
journaled · the settlement daemon runs a close at boot before the delay check · a balance rebuild can
overwrite a concurrent `CloseBatch` (no lock) · webhook replay may not keep the original delivery ids
· outbound verify checks the timestamp after the comparison · an acquirer secret leaked in the
reference history (must be rotated) · Postgres and the internal settlement API listen on all
interfaces · `readyz` doesn't check the database.

A decoy we checked and left alone: `v1/fees/calculateFee.ts` ("Claude says half-up is a bug") is dead
code (T-35).

## 5. Where to find more

| What | Where |
|---|---|
| Every task, in priority order, with the live status | `docs/challenge/PLAN.md` → Master order |
| Full audit (root cause per analysis ID) | `docs/challenge/ANALYSIS.md` |
| Every false claim we found | `docs/challenge/TRAPS.md` |
| Decisions and step log | `IMPLEMENTATION.md` |
| Per-bug write-ups | `docs/bugs/` |
| Test baseline before the fixes | `docs/challenge/TEST-BASELINE.md` |
