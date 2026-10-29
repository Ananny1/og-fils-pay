# FilsPay — Work Plan

**How to use this file:** the **Master order** below is the one list of every task and the **only
status that counts**. Work top to bottom (`WORKFLOW.md`); a task whose "Needs" isn't ✅ waits.
The sections after it hold details (files, test ideas) and are not kept in sync for status.
Details for each ID are in `ANALYSIS.md`; the live checkpoint is `PROGRESS.md`.

**Status:** ⬜ todo · ⏳ in progress · ✅ done · ⏭ skipped (say why)
**Points:** ★★★ critical (security / money lost or duplicated) · ★★ wrong money · ★ reliability / reporting
**Evidence:** S1 security brief · S2 FP-300 sheet · S3 finance & ops weekly · S4 support tickets (`evidence/`)

Paths are relative to the repo root. `api/` = `apps/api/src/`, `stl/` = `apps/settlement/internal/`.

---

## Master order

Ordered by **what must work first**: you can't test anything if it doesn't run (Tier 0), nobody
should get in who shouldn't (Tier 1: login is the entry), then who can do what (Tier 2), then money
coming in (Tier 3), money maths (Tier 4), what shops are told (Tier 5), the missing feature (Tier 6),
the screens (Tier 7) and hand-in (Tier 8).

| # | ID | Task | ★ | Evidence | Needs | Status |
|---|---|---|---|---|---|---|
| **Tier 0** | | **Runs at all** | | | | |
| 0.1 | DEP-001 | Missing Dockerfiles | ★★★ | S1 "docker compose up" | — | ✅ |
| 0.2 | DEP-002 | Fresh migrate fails (0054, 0055) | ★★★ | HANDOVER | — | ✅ |
| 0.3 | DEP-003 | Compose never loads service settings | ★★★ | compose header | — | ✅ |
| 0.4 | BUG-050 | Poisoned AI instruction files | ★★★ | flag, ANALYSIS §0 | — | ✅ |
| 0.5 | F0 | Dashboard home URL, not-found / error pages | ★ | found running it | — | ✅ |
| 0.6 | BUG-009 | `expire_holds` deletes every hold | ★★★ | HANDOVER | — | ✅ |
| 0.65 | BUG-058 | Built-in dev webhook key invalid (34 bytes) → API and seed crash without a key | ★★ | S1 | — | ✅ |
| 0.7 | DEP-004 | `docker compose up` **from `ops/`** (the brief's own instruction) must work: migrate before seed before services, no settings file required for local | ★★ | S1 | — | ✅ |
| 0.75 | DEP-005 | `npm test` never ran the API/reporting suites (Node 20 doesn't expand the test glob) | ★★ | — | — | ✅ |
| 0.8 | T1 | Test baseline: run `npm test` + `go test ./...`, record what already fails | — | — | 0.7 | ⬜ |
| **Tier 1** | | **Login (the entry point)** | | | | |
| 1.1 | BUG-001 | Login works without the OTP | ★★★ | S3 group chat | — | ⬜ |
| 1.2 | BUG-002 | OTP binds to another shop's user with the same email | ★★★ | S4 "OTP changed" | 1.1 | ⬜ |
| 1.3 | BUG-011 | OTP guessable: parallel attempts bypass the limit; codes from `Math.random` | ★★ | S4 "OTP … still safe?" | 1.1 | ⬜ |
| 1.4 | BUG-031 | OTP returned in the login reply and logged (`otpDevExpose` defaults on) | ★★★ | S4 "OTP … still safe?" | 1.1 | ⬜ |
| 1.5 | BUG-032 | Admin session not rotated after OTP (fixation) | ★ | — | 1.1 | ⬜ |
| **Tier 2** | | **Who can do what** | | | | |
| 2.1 | BUG-010 | "View as merchant" gives super_admin **owner** powers, and can write | ★★★ | HANDOVER | Tier 1 | ⬜ |
| 2.2 | BUG-003 | Shop A cancels shop B's payment link (IDOR) | ★★★ | S3 group chat | Tier 1 | ⬜ |
| 2.3 | BUG-033 | Admin actions missing role checks: audit every `/v1/admin` route | ★★ | S4 "admin … role checks" | Tier 1 | ⬜ |
| 2.4 | BUG-012 | API key rotation leaves the old key working | ★★ | S4 "key rotation" | Tier 1 | ⬜ |
| 2.5 | BUG-013 | Credit two-person check compares display names | ★★ | — | Tier 1 | ⬜ |
| **Tier 3** | | **Money coming in** | | | | |
| 3.1 | BUG-004 | Expired payment link still payable (client `submittedAt`) | ★★★ | S4 FP-187 | — | ⬜ |
| 3.2 | BUG-005 | Payment link charged twice (slow payment) | ★★★ | S4 incident 2026-05-14 | 3.1 | ⬜ |
| 3.3 | BUG-007 | Acquirer callback signature optional / re-serialised / no freshness / outcome unchecked | ★★★ | S4 FP-240 "incoming check" | — | ⬜ |
| 3.4 | BUG-006 | Duplicate acquirer callbacks saved twice | ★★★ | S4 FP-201 (reopened) | 3.3 | ⬜ |
| 3.5 | BUG-008 | Duplicate payout notifications + disbursements | ★★★ | S4 incident 2026-08-21 | — | ⬜ |
| **Tier 4** | | **Money maths and settlement** | | | | |
| 4.1 | BUG-014 | CSV import reads 4.75 BD as 0.475, 4.755 as 4.750 | ★★★ | S3 "10x??" | — | ⬜ |
| 4.2 | BUG-020 | Daily close at 03:00 Bahrain instead of midnight | ★★ | S3, S4 | — | ⬜ |
| 4.3 | BUG-015 | Scheme statement always a few fils over | ★★ | S3 | — | ⬜ |
| 4.4 | BUG-016 | Delta Marketplace split payouts lose fils | ★★★ | S3, S4 | — | ⬜ |
| 4.5 | BUG-017 | "Recalculate cached balances" 135K → 7K | ★★★ | S3, S4 FP-203 | — | ⬜ |
| 4.6 | BUG-018 | MDR recalculation rewrites paid batches | ★★★ | S3 | — | ⬜ |
| 4.7 | BUG-019 | Test merchants paid in the real settlement run | ★★★ | S3, S4 | — | ⬜ |
| 4.8 | BUG-021 | Net payout in float32 | ★★ | — | — | ⬜ |
| 4.9 | BUG-022 | Platform volume counter int32 overflow | ★★ | — | — | ⬜ |
| 4.10 | BUG-028 | Lifetime payout estimate drifts | ★★ | S3 group chat | — | ⬜ |
| 4.11 | BUG-027 | March sweep doubles the gap when run twice | ★★ | S3 | — | ⬜ |
| 4.12 | BUG-029 | Adjustment import has no double-submit guard | ★★ | — | 4.1 | ⬜ |
| 4.13 | BUG-051 | Scheme residue never posted (ADR-0002) | ★★ | ADR-0002 | 4.3 | ⬜ |
| 4.14 | BUG-052 | Capture fee ignores negotiated discount; settlement applies it | ★★ | — | — | ⬜ |
| 4.15 | BUG-053 | Split child without a balance row → payout no-op | ★ | — | 4.4 | ⬜ |
| **Tier 5** | | **What shops are told (webhooks, reports)** | | | | |
| 5.1 | BUG-023 | Outbound webhook signs different bytes than it sends | ★★★ | S4 FP-240 | — | ⬜ |
| 5.2 | BUG-024 | Settlement summary double-counts and is slow | ★★ | S4 "reporting … slow" | — | ⬜ |
| 5.3 | BUG-025 | Large export: all in memory; streaming version skips rows | ★★ | S4 "large export" | — | ⬜ |
| 5.4 | BUG-030 | CSV export formula injection | ★ | — | 5.3 | ⬜ |
| 5.5 | BUG-026 | Dashboard fee 245 vs 225 bps | ★★ | S3 | — | ⬜ |
| 5.6 | BUG-054 | Reconciliation uses `merchants.mdr_bps` (no sync trigger) | ★ | — | 5.5 | ⬜ |
| 5.7 | BUG-055 | Rollups / metrics / analytics bucketed by UTC date | ★ | — | 4.2 | ⬜ |
| **Tier 6** | | **FP-300 Refunds (the missing feature)** | | | | |
| 6.1 | BUG-034 | Two refunds at once both succeed | ★★★ | S4 FP-209 | — | ⬜ |
| 6.2 | BUG-035 | Refund more than was captured | ★★★ | S4 "refund more than charged" | — | ⬜ |
| 6.3 | BUG-036 | Refund another shop's transaction | ★★★ | — | — | ⬜ |
| 6.4 | BUG-056 | Fee reversal across partial refunds can exceed the original fee | ★★ | S2 "fees … right" | — | ⬜ |
| 6.5 | BUG-057 | Status after a full refund of a partial capture | ★ | — | — | ⬜ |
| 6.6 | FP-300.1 | Refund route + guards + required `Idempotency-Key` | ★★★ | S2 "through the API" | 6.1–6.3 | ⬜ |
| 6.7 | FP-300.2 | Ledger to the fil | ★★★ | S2 "ledger … fils" | 6.6 | ⬜ |
| 6.8 | FP-300.3 | Next settlement batch reduced by refunds (R9) | ★★★ | S2 "payouts" | 6.7 | ⬜ |
| 6.9 | FP-300.4 | `refund.succeeded` webhook (R6) | ★★ | S2 "right webhook" | 5.1, 6.6 | ⬜ |
| 6.10 | FP-300.5 | Timeline, reports, reconciliation (R7, R8) | ★★ | S2 "timeline … reconciliation" | 6.7 | ⬜ |
| 6.11 | FP-300.6 | End-to-end refund tests | ★★ | S2 | 6.6–6.10 | ⬜ |
| **Tier 7** | | **Screens** (Phase F, details below) | | | | |
| 7.1 | F1–F13 | Frontend fixes (refund drawer, checkout, login, read-only impersonation, 3 decimals, …) | ★ | S2 "timeline" | per item | ⬜ |
| 7.2 | T5 | Page checklist: every page × every state | ★ | — | 7.1 | ⬜ |
| **Tier 8** | | **Hand-in** | | | | |
| 8.1 | T2–T4 | Full suite green, API smoke script, frontend tests | — | — | Tiers 1–7 | ⬜ |
| 8.2 | D4, D5, D7 | Rotate leaked secret; no public DB / internal ports; `readyz` checks DB | ★★ | — | — | ⬜ |
| 8.3 | DEPLOY | Live on Dilmune Cloud | ★★★ | S1, S2 | 8.2 | ⬜ |
| 8.4 | T6, T7 | Fresh-clone check; final read of every write-up | — | — | 8.3 | ⬜ |

**Later (low points):** A12 API keys bypass role gates (documented) · B4 "Adjust balance" is
cache-only · S10 daemon closes on boot · S11 rebuild vs CloseBatch race · W8 replay keeps delivery
ids? · W9 timestamp check order.

## Task types (how every item is classified)

| Type | ID | What it is | Scored by the brief? | Where it's written up |
|---|---|---|---|---|
| **Bug** | `BUG-NNN` | The code does something wrong against the spec (ADRs, HANDOVER, the sheets) or is insecure | ✅ yes (main points) | `docs/bugs/BUG-NNN-*.md` |
| **Deploy blocker** | `DEP-NNN` | Stops the app from building, migrating, starting or deploying | ✅ (needed for "live on Dilmune Cloud") | `docs/bugs/DEP-NNN-*.md` |
| **Feature** | `FP-300.x` | The missing feature the brief asks us to finish (Refunds) | ✅ yes | `docs/bugs/` + FP-300 section in `IMPLEMENTATION.md` |
| **Frontend item** | `F<n>` | A screen that is broken or unclear (some are bugs, some polish) | partly | `docs/bugs/F<n>-*.md` |
| **Test / QA** | `T<n>` | Baselines, smoke scripts, checklists | supports all | `IMPLEMENTATION.md` step log |
| **Enhancement** | `ENH-NNN` | Not a bug: an improvement beyond what the spec asks (e.g. email OTP delivery). Done only after approval, and after the tier it supports | ➕ bonus only | `docs/enhancements/ENH-NNN-*.md` |
| **Idea** | — | Not yet judged; parked in `PROGRESS.md` → Ideas | — | becomes an ENH when approved |

**Rule:** a bug fix is the **smallest** change that removes the root cause. Anything bigger
("while we're here…") is split off as an `ENH`, so fixes stay small and enhancements are a
separate, optional decision.

## Enhancements (bonus, after approval)

| ID | Enhancement | Supports | Why | Cost | Status |
|---|---|---|---|---|---|
| ENH-001 | **Email OTP delivery**: real email via SMTP; Mailpit inbox at `localhost:8025` for local runs; possibly reuse Ebrahim's "chattrix" (Q-6) | BUG-031 | After BUG-031 the code no longer shows on screen; users still need to receive it, and a demo can show the full login | ~1 file per notifier + compose service + 1 dependency | 💡 |
| ENH-002 | Authenticator-app second factor (TOTP, e.g. Microsoft Authenticator) | Tier 1 | No code sent at all; strongest option | Enrolment flow, secret storage, recovery codes, UI, migration | 💡 |
| ENH-003 | Proper CORS allowlist on the API for production (instead of the dev proxy) | F12, DEPLOY | Dashboards hosted on another origin can call the API safely | Small API plugin + config | 💡 |
| ENH-004 | `scripts/lib/sqlFilter.ts`: refuse an empty filter, or delete it (now unused) | BUG-009 | Removes a footgun that turned "delete these" into "delete all" | Tiny | 💡 |
| ENH-005 | Rate limiting on login, OTP resend and pending-session lookups | BUG-011 | Slows brute force and resend abuse beyond the per-challenge attempt limit | Small middleware | 💡 (may become a bug if BUG-011 shows it's exploitable) |
| ENH-006 | Per-service database roles + TLS to Postgres | D5, DEPLOY | Least privilege; one leaked service can't touch everything | Migration + compose | 💡 |

## Evidence coverage (every line of the 4 sheets → a task)

| Sheet | Line | Task |
|---|---|---|
| S1 | "Money rule: whole fils only" · "closes at midnight, Bahrain time" | BUG-014, BUG-020, BUG-021, BUG-050 |
| S1 | "Run `docker compose up` in `ops/`" | DEP-001–004 |
| S1 | "For each bug, a short note: what's wrong, why, what it breaks" | Summary block in every write-up |
| S2 | FP-300: through the API · ledger to the fils · fees and payouts · right webhook · timeline, reports, reconciliation · live on Dilmune Cloud | Tier 6, 8.3 |
| S3 | Scheme statement a few fils over | BUG-015 (+ BUG-051) |
| S3 | March sweep ran twice, gap doubled | BUG-027 |
| S3 | Delta Marketplace split payouts short | BUG-016 |
| S3 | "Recalculate cached balances" 135K → 7K | BUG-017 |
| S3 | MDR recalculation changed paid batches | BUG-018 |
| S3 | Dashboard fee 245 vs 225 bps | BUG-026 (+ BUG-054) |
| S3 | CSV import 4.755 → 4.750, 4.75 → 0.475 | BUG-014 |
| S3 chat | Daily close at 3am | BUG-020 |
| S3 chat | Lifetime payout estimate drifts | BUG-028 |
| S3 chat | Test merchants in the real settlement run | BUG-019 |
| S3 chat | Login works without the OTP | BUG-001 |
| S3 chat | Cancelled merchant B's link from A's dashboard | BUG-003 |
| S4 | FP-187 link paid after expiry | BUG-004 |
| S4 | FP-201 duplicate acquirer callbacks (reopened) | BUG-006 |
| S4 | FP-203 balance cache 135K → 7K | BUG-017 |
| S4 | FP-209 concurrent refund, double money | BUG-034 |
| S4 | FP-240 webhook signatures rejected; incoming check has problems | BUG-023, BUG-007 |
| S4 | Incident 2026-05-14 link charged twice | BUG-005 |
| S4 | Incident 2026-08-21 duplicate payout notifications | BUG-008 |
| S4 note | Refund more than was charged | BUG-035 |
| S4 note | Splits a few fils short | BUG-016 |
| S4 note | Admin actions without the right role checks | BUG-033 (+ BUG-010) |
| S4 note | Key rotation doesn't do what you'd expect | BUG-012 |
| S4 note | Daily close timing doesn't match the docs | BUG-020 |
| S4 note | A reporting query is suspiciously slow | BUG-024 |
| S4 note | Test merchants when certain admin tools run | BUG-019 |
| S4 note | OTP implementation changed — still safe? | BUG-001, BUG-002, BUG-011, BUG-031 |
| S4 note | Uploading a really large export | BUG-025 |

---

## Team split (2 people)

**Ebrahim is responsible for every task in the Master order** (decided 2026-10-29). The Track A /
Track B tables below remain as a way to hand work to Sayed: Sayed takes a task only by marking it
⏳ with his name in the Master order (and in `PROGRESS.md`) first, so the two never work on the
same task. Frontend (Tier 7) stays with Ebrahim. Details per person: `TEAM.md`.

### Track A — "Who can get in" (security, TypeScript `apps/api`) — **Sayed**

| Order | ID | Bug # | What | Main files |
|---|---|---|---|---|
| 1 | A1 | BUG-001 | Login without OTP | `api/auth/sessions.ts` |
| 2 | A2 | BUG-002 | OTP logs you into another shop | `api/routes/auth.ts` |
| 3 | A6 | BUG-003 | Shop A cancels shop B's link | `api/paymentLinks/cancel.ts` |
| 4 | A7/A8 | BUG-010 | Impersonation = owner powers | `api/admin/impersonation.ts` |
| 5 | P1 | BUG-004 | Expired link still payable | `api/paymentLinks/pay.ts` |
| 6 | P2 | BUG-005 | Link charged twice | `api/paymentLinks/pay.ts` |
| 7 | W2 | BUG-006 | Duplicate acquirer callbacks | `api/acquirer/callbacks.ts` |
| 8 | W3–W5 | BUG-007 | Callback signature optional | `api/webhooks/inboundVerify.ts` |
| 9 | A3/A4 | BUG-011 | OTP brute force + `Math.random` | `api/routes/auth.ts`, `api/lib/random.ts` |
| 10 | A11 | BUG-012 | Old API key still works | `api/admin/apiKeys.ts`, `api/apiKeys/verify.ts` |
| 11 | A9 | BUG-013 | Credit self-approval | `api/admin/creditApproval.ts` |
| 12 | A5 | — | OTP shown in the login reply | `api/config.ts` |
| 13 | Q2/Q3, Q4 | BUG-025, BUG-030 | Export: memory, skipped rows, formula injection | `api/transactions/exportCsv.ts` |
| 14 | Q5 | BUG-026 | Dashboard fee 245 vs 225 | `api/fees/currentFeeScheduleDisplay.ts` |
| 15 | W1 | BUG-023 | Webhook signs different bytes than it sends (Yousif's `ya/sign-raw`) | `api/webhooks/dispatcher.ts` (send path), `api/webhooks/sign.ts` |
| 16 | Q1 | BUG-024 | Settlement summary double-counts | `api/settlement/query.ts` |
| 17 | B3 | BUG-029 | Adjustment import double-submit | `api/admin/adjustmentImport.ts` |

### Track B — "Is the money right" (money + settlement, Go `apps/settlement` + money tools) — **Ebrahim**

| Order | ID | Bug # | What | Main files |
|---|---|---|---|---|
| 1 ✅ | B6 | BUG-009 | Holds script deletes every hold | `scripts/expire_holds.ts` |
| 2 | B2 | BUG-014 | CSV import 10× off | `api/admin/adjustmentCsvParsing.ts` |
| 3 | S1 | BUG-020 | Daily close at 03:00 instead of midnight | `stl/settlement/window.go`, `stl/scheduler/daemon.go` |
| 4 | S3 | BUG-015 | Scheme file a few fils over | `stl/settlement/scheme_export.go` |
| 5 | S5 | BUG-016 | Split payouts lose fils | `stl/splits/allocate.go` |
| 6 | B1 | BUG-017 | Rebuild balances 135K → 7K | `stl/internalapi/server.go` |
| 7 | S6 | BUG-018 | MDR recalculation rewrites paid batches | `stl/settlement/recalculate_mdr.go` |
| 8 | S7 | BUG-019 | Test shops get real payouts | `api/admin/merchantFlags.ts` |
| 9 | W6/W7 | BUG-008 | Duplicate payout notifications | `stl/settlement/payout_notify.go`, `api/webhooks/dispatcher.ts` |
| 11 | S2, S8, S9 | BUG-021, 022, 028 | float32 net, int32 overflow, drifting estimate | `stl/settlement/payable.go`, `platform_volume.go`, `payout_estimate.go` |
| 12 | B5 | BUG-027 | March sweep runs twice | `scripts/reconcile_march.ts` |
| 14 | S4, P3, Q6, Q7/P4/Q8 | — | Residue posting, fee mismatch, UTC-date bucketing | see Phases 3–4 |

### Together

- **First (both):** pull, set up Docker (see Phase 1), and run the test baseline once.
- **FP-300 Refunds (after Phases 2–3):** Sayed (A) does API route, locking, validation, state, ledger, tests (steps 1–3, 5–6, 11). Ebrahim (B) does fee reversal, settlement batch, webhook, reports (steps 4, 7, 8, 10) and the refund screens (step 9, in Phase F).
- **Phase 6 deploy:** whoever finishes first; the other reviews.

### Rules so we don't collide

| Shared thing | Rule |
|---|---|
| Git | Before each bug: `git pull --rebase origin main`. After each fix commit, push so the other gets it. |
| New migrations | Track A uses **0073–0079**, Track B uses **0080–0089**. Never reuse a number. |
| New bug numbers (bugs not listed yet) | Track A **BUG-031–049**, Track B **BUG-050–069**. |
| `IMPLEMENTATION.md`, `PLAN.md` | Edit only your own rows. Each new decision gets the next free D-number; on a clash, rename yours. |
| Same file needed | `api/webhooks/dispatcher.ts` is shared: Sayed owns the send/sign path (W1), Ebrahim the payout effects (W6). `api/payments/capture.ts` is Ebrahim's. Frontend (`apps/web`, `apps/admin`) is Ebrahim's. Tell the other before touching their files. |
| A trap found | Add it to `TRAPS.md` right away and tell your mate. |

---

## Phase 0 — Setup ✅

| Task | Status |
|---|---|
| Read the brief, sheets, docs, ADRs, history; decode the CTF flag | ✅ |
| Full audit → `ANALYSIS.md` | ✅ |
| Replace poisoned agent files, write `GUIDE.md`, `TRAPS.md`, `PLAN.md`, bug template (**BUG-050**, write-up + guard test) | ✅ |
| Block `git push` for agents (`.claude/settings.json`) | ✅ |

## Phase 1 — Get it running locally (deploy blockers) ✅

Without these we can't reproduce or test anything.

| ID | Bug # | Task | Files | Status |
|---|---|---|---|---|
| D1 | DEP-001 | Add the missing Dockerfiles (multi-stage; clean the Go build cache, the box has only 2 GB of disk) | `ops/Dockerfile.node`, `ops/Dockerfile.go`, `ops/docker-compose.yml` | ✅ |
| D3 | DEP-002 | Make a fresh `migrate` succeed: neutralise 0054 (`v_unbatched_capture_events` refers to a table that doesn't exist) | `db/migrations/0054_views.sql`, `db/migrate.ts` | ✅ |
| D2 | DEP-003 | Compose must load the service env (`env_file`), production mode, real secrets | `ops/docker-compose.yml`, `apps/api/src/config.ts` | ✅ |
| — | — | Run `npm test` + `go test ./...`, record the baseline (what fails before we start) | — | ⬜ |

**Run it locally:** see `SETUP.md` (Docker, migrate, seed, dashboards, logins, tests).
Seen while running: the settlement daemon ran `RunDailyBatch` straight at boot (S10).

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
| B6 | BUG-009 | `expire_holds` **deletes every hold** when nothing expired | `scripts/expire_holds.ts`, `scripts/lib/sqlFilter.ts` | nothing expired → 0 rows touched; status flipped, never deleted | ✅ |
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

## Phase F — Frontend / UI / UX (Ebrahim, last)

Done after the backend fix each item depends on. Code: `apps/web/src/` (shop + checkout, :5173) and
`apps/admin/src/` (staff console, :5174). Live reload in Docker. **Judges click around: every page
must load, every error must show a clear sentence, never a blank page, raw JSON or a stack trace.**

### F-fixes

| ID | Task | Files | Depends on | Status |
|---|---|---|---|---|
| F0 | `/` → dashboard; "Page not found" + "Something went wrong" pages in both apps | `apps/*/src/router.tsx`, `apps/*/src/components/RouteErrorPage.tsx` | — | ✅ |
| F1 | Refund drawer + refunds in the transaction timeline (FP-300 step 9); restore the refunds route ("removed until FP-212") | `apps/web/src/pages/transactions/RefundDrawer.tsx`, `TransactionDetailPage.tsx`, `apps/web/src/api/transactions.ts`, `router.tsx` | FP-300 steps 1–8 | ⬜ |
| F2 | Checkout stops sending `submittedAt` (server decides expiry) | `apps/web/src/pages/checkout/CheckoutPage.tsx`, `apps/web/src/api/paymentLinks.ts` | BUG-004 | ⬜ |
| F3 | Login pages work without the dev OTP on screen (clear "check your email" step) | both `LoginPage.tsx` | A5 | ⬜ |
| F4 | "View as merchant" is visibly read-only (banner, no write buttons) | `apps/admin/src/components/ImpersonationBanner.tsx`, `apps/web` write actions | BUG-010 | ⬜ |
| F5 | Every amount shown as BD with **3 decimals** (fils), never 2 | `apps/web/src/format.ts`, `apps/admin/src`, search `toFixed`, `/ 100` | — | ⬜ |
| F6 | Refunds shown in reports, settlement and reconciliation pages | `apps/web/src/pages/settlement/*`, `apps/admin/src/pages/settlement/` | FP-300 step 10 | ⬜ |
| F7 | Session expired mid-use → back to login with a message (not a broken page) | `apps/*/src/api/client.ts`, auth contexts | — | ⬜ |
| F8 | API down / network error → one clear message on every page | `describeError` in both `client.ts` | — | ⬜ |
| F9 | Correct browser tab title per page (the shop app says "FilsPay Checkout" everywhere) | `apps/web/index.html`, pages | — | ⬜ |
| F10 | Money buttons can't be double-clicked (pay, refund, capture, void, credits, imports) | pages with submit buttons | — | ⬜ |
| F11 | Dates and times shown in Bahrain time | `apps/*/src/format.ts` | — | ⬜ |
| F13 | Login forms: trim spaces/commas around the email (only Merchant ID is trimmed today) and show a clear "wrong Merchant ID, email or password" message | both `LoginPage.tsx` | — | ⬜ |
| F12 | Production build of both dashboards for the deploy, with SPA fallback so a refresh on a deep link (e.g. `/dashboard/transactions/123`) doesn't 404 | `ops/` | Phase 6 | ⬜ |

### Page checklist (every page × every state)

For each page check: **loads**, **loading state**, **empty state**, **API error** (shows a sentence),
**403** (no permission), **401** (session gone → login), **not found** (bad id in the URL),
**3-decimal amounts**, **mobile width**. Tick a page when all apply.

**Shop app (`apps/web`, http://localhost:5173)**

| URL | Page | Who | Checked |
|---|---|---|---|
| `/` | → `/dashboard` | all | ✅ (F0) |
| `/dashboard/login` | Login (Merchant ID + email + password → OTP) | all | ⬜ |
| `/dashboard` | → transactions | all | ⬜ |
| `/dashboard/transactions` | Transaction list, filters, export | all | ⬜ |
| `/dashboard/transactions/:id` | Detail, timeline, capture/void, refund drawer | all (writes: owner/finance) | ⬜ |
| `/dashboard/payment-links` | Link list | all | ⬜ |
| `/dashboard/payment-links/new` | Create link | owner/finance | ⬜ |
| `/dashboard/payment-links/:id` | Link detail, cancel | all | ⬜ |
| `/dashboard/webhooks`, `/new`, `/:id` | Webhook endpoints | owner/finance | ⬜ |
| `/dashboard/settlement` | Settlement batches | all | ⬜ |
| `/dashboard/settlement/:id` | Batch detail | all | ⬜ |
| `/dashboard/reconciliation` | Reconciliation | owner/finance | ⬜ |
| `/dashboard/overview` | Overview / analytics | all | ⬜ |
| `/pay/:token` | Public checkout: valid, not found, expired (410), paid, canceled, declined (402), acquirer error (502), success | public | ⬜ |
| any other URL | "Page not found" | — | ✅ (F0) |

**Staff console (`apps/admin`, http://localhost:5174)**

| URL | Page | Who | Checked |
|---|---|---|---|
| `/login` | Login (email + password → OTP) | staff | ⬜ |
| `/` | → `/merchants` | staff | ✅ |
| `/merchants` | Merchant list, bulk actions | staff | ⬜ |
| `/merchants/:id` | Detail: impersonate, API keys, balance adjust, flags | staff (by role) | ⬜ |
| `/credits` | Credit requests, two-person approval | finance+ | ⬜ |
| `/settlement` | Settlement ops: run batch, rebuild balances, MDR recalculation | finance+ | ⬜ |
| `/adjustment-imports` | CSV adjustment import | finance+ | ⬜ |
| `/webhooks`, `/webhooks/:merchantId` | Webhook replay | staff | ⬜ |
| any other URL | "Page not found" | — | ✅ (F0) |

## Phase T — Tests and final checks (both)

Every fix already ships with its own test (the per-bug rule). This phase makes sure nothing is
missed at the end.

| ID | Task | Owner | Status |
|---|---|---|---|
| T1 | Baseline: run `npm test` (in Docker) + `go test ./...` before any fix; record what already fails | both (first) | ⬜ |
| T2 | Keep the full suite green after each fix; tests that encode a bug are changed and explained (D-004) | each for own track | ⬜ |
| T3 | API smoke script: one command that logs in, creates a link, pays, refunds, checks the ledger and webhook. Used for the demo | Sayed | ⬜ |
| T4 | Frontend tests for routes and error pages (`apps/web/src/*.test.ts` pattern; `apps/admin` has none yet) | Ebrahim | ⬜ |
| T5 | Page checklist above fully ticked in the browser | Ebrahim | ⬜ |
| T6 | Fresh-clone test: clone into a new folder, follow `SETUP.md` exactly, everything runs | the other person (not the author) | ⬜ |
| T7 | Final read of every `docs/bugs/*.md` against the 6-question template | both | ⬜ |

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
