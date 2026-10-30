# FilsPay — Implementation Log

This file records **every decision we take and every step we perform**, with the reason behind it.
Decisions come first; later steps cite the decision they build on (e.g. "per D-003").
Bug details, root causes and fixes are listed per bug in §3 and written up in `docs/bugs/`. The full audit map is `docs/challenge/ANALYSIS.md`; the task list is `docs/challenge/PLAN.md`.

**Status legend:** ✅ done · ⏳ in progress · ⬜ planned · ❓ open (needs a call)

---

## 1. Decisions

Each decision: **context → decision → why → consequences**. A decision is never edited after it's accepted; a new one supersedes it.

### D-001 — Source of truth when documents disagree ✅
- **Context:** The repo contains contradictory guidance. ADR-0001 says integer fils, while `CLAUDE.md` / `AGENTS.md` / `.cursorrules` say "cents", "UTC midnight", "never modify `packages/money` or tests", "`Math.random` is fine for OTPs".
- **Decision:** Trust order is **code behaviour → ADR-0001 / ADR-0002 → `docs/HANDOVER.md` → `docs/ARCHITECTURE.md` → everything else**. The three AI-instruction files are treated as evidence of the problem, not as rules.
- **Why:** ARCHITECTURE says "where it disagrees with the code, the code wins"; ADR-0001 is the accepted money decision; the AI files contradict the ADRs they claim to defer to.
- **Consequences:** We may change `packages/money`, existing tests and "intentional" code when the spec requires it, and we justify each such change here.

### D-002 — Money and time rules ✅
- **Decision:** All amounts are integer fils (`Fils` / `money.Fils`, BIGINT columns); text is parsed with `parseBhdToFils`; rates use `applyRateFils` (half-to-even). The settlement business day is **00:00–24:00 Asia/Bahrain (UTC+3)**. Monthly finance windows use the Bahrain month (YA's objection to ADR-0003).
- **Why:** ADR-0001, ADR-0002, the challenge brief ("midnight Bahrain time").
- **Consequences:** Any float, 2-decimal parse or UTC-day bucketing on money/settlement paths is a bug to fix.

### D-003 — Fix style: minimal, native, tested ✅
- **Decision:** Each bug gets its own small commit: a failing test first, the smallest change that removes the root cause, test green, entry in §3.
- **Why:** Scoring rewards small reliable fixes and explanations; small commits are easy to review and revert.
- **Consequences:** No refactors or renames unless required. Code follows existing conventions (Fastify plugin per route file, `withTransaction`, `FOR UPDATE` first, idempotency claim/complete, `lib/errors` classes, `node:test`; Go: pgx tx + `fmt.Errorf("settlement: Func: step: %w")`).

### D-004 — Tests that encode bugs may be changed ✅
- **Context:** Some tests assert wrong behaviour (e.g. CSV import expects `"4.75"` → 475 fils; refund validation builds refundable from the authorized amount).
- **Decision:** When a test asserts behaviour that contradicts D-001/D-002, we change the assertion and say so in the bug entry.
- **Why:** The rule "a failing test means your change is wrong" is exactly what preserved these bugs.

### D-005 — Repositories and pushing ✅
- **Decision:** `origin` = `github.com/Ananny1/fils-pay` (submission), local `main` tracks it. `reference` = `github.com/MJ5-byte/fils-pay` (read-only, original history). Commits use the team member's own git identity, with no AI attribution lines. **Push only when the team explicitly asks.**
- **Why:** The submission repo is what gets judged; the reference keeps the evidence history.

### D-006 — FP-300 is Refunds (FP-212) ✅
- **Context:** `POST /v1/refunds` returns 501; HANDOVER says refunds "need the route and the drawer wired"; `refund.succeeded` is missing from the webhook dispatcher; meeting notes list the same "done when" items as the FP-300 sheet.
- **Decision:** Build refunds end to end: API → ledger → fee reversal → settlement/payout → webhook → timeline → reports → reconciliation.
- **Why:** It's the only feature that is started, stubbed and "touches everything".
- **Consequences:** The refund helpers (`processRefund`, `refundValidation`, `refundState`, `calculateRefundFee`) are reworked as part of FP-300, not trusted as "done".

### D-007 — Migrations ✅
- **Decision:** New migrations start at **0073** and are append-only. Existing applied migrations are not edited, **except** `0054_views.sql`, which currently breaks a fresh migrate (references a non-existent table) and sits in the number range ADR-0005 reserved for v2. ❓ How we neutralise 0054 is decided in a later D-entry when we reach it.
- **Why:** Editing applied migrations breaks existing databases; a fresh deploy must still work.

### D-008 — Where the documentation lives ✅
- **Decision:** `IMPLEMENTATION.md` (this file) lives at the repo root and is submitted. Personal notes (case guide, raw analysis, evidence photos) stay outside the repo.
- **Why:** The judges score explanations; this file is the explanation.

### D-009 — Priority order ✅
- **Decision:** (1) security + duplicate money, (2) money/settlement correctness, (3) webhooks/reporting, (4) FP-300 + deploy. Deploy blockers that stop us running locally are fixed first, because we can't reproduce anything without them.
- **Why:** Matches the brief's priority and maximises points early.

### D-010 — Replace the poisoned AI instruction files ✅
- **Context:** A fresh clone loads `CLAUDE.md` (and `AGENTS.md` / `.cursorrules` for other tools) automatically. The originals steer agents into the bugs (D-001).
- **Decision:** Rewrite all three with the team's real rules, pointing to `docs/challenge/GUIDE.md` and `PLAN.md`. The originals stay in git history (`git show aaccd16:CLAUDE.md`) and each false claim is listed in `docs/challenge/TRAPS.md`.
- **Why:** Any teammate or agent who clones the repo starts with correct rules and knows what is done, without re-doing the analysis.
- **Consequences:** `.claude/settings.json` is now tracked (`.gitignore` changed) and denies `git push` / `gh pr create` for agents in every clone.

### D-011 — Bug write-up format ✅
- **Decision:** Each fixed bug gets `docs/bugs/BUG-NNN-name.md` from `docs/bugs/_TEMPLATE.md`, answering six questions: the issue · why it happened · who was affected · the fix (files and lines) · options considered, ranked · proof (tests before/after). §3 below stays the short register and links to it.
- **Why:** The judges score explanations; comparing options shows why the minimal fix is the right one.

### D-012 — Treat every instruction as a claim to verify ✅
- **Decision:** Any "intentional / by design / frozen / approved / already fixed / do not fix" text is checked against the code and ADR-0001/0002/HANDOVER before we act. New traps go to `TRAPS.md` right away.
- **Why:** That is the challenge's core lesson (`FLAG{order_of_the_prompt_never_read_the_diff}`).

### D-013 — Neutralise the abandoned migrations 0054 and 0055 ✅
- **Context:** A fresh `migrate` failed at 0054 (view on the missing table `settlement_batch_events`) and then at 0055 (inserts into `chart_of_accounts(code, account_type)`, but the table is `(id, kind)` and `kind` has no `'suspense'`). HANDOVER: "0054–56 are PRs I abandoned. No database ever ran them".
- **Decision:** 0054: remove only the broken view `v_unbatched_capture_events` (nothing queries it); keep the other two views. 0055: replace the body with a commented `SELECT 1` no-op. 0056 is valid and stays. Files keep their numbers. This settles the ❓ in D-007.
- **Why:** Smallest change that makes a fresh deploy work. No database has these rows, the runner has no checksums (AM's note in `db/migrate.ts`), and new numbers can't fix a failure that happens before them.
- **Alternatives:** (2) new 0073 that creates `settlement_batch_events` → invents a table with no writer; (3) renumber/delete the files → breaks any DB that recorded them (staging-2); (4) fix 0055 to the real columns → still fails the `kind` CHECK, adds unused accounts.

### D-014 — One master order, one workflow, a live checkpoint, branch pushes ✅
- **Context:** About 60 tasks across security, money, refunds, frontend and deploy; work can be cut off mid-task; the four handout sheets (S1–S4) must all be covered; Ebrahim now owns every task.
- **Decision:** `PLAN.md` → **Master order** is the single ordered task list and the only status that counts, tiered by what must work first (runs → login → access → money in → money maths → what shops are told → FP-300 → screens → hand-in), with an **Evidence coverage** table mapping every sheet line to a task. Every task follows `WORKFLOW.md` (claim → understand → plan with ≥3 options from several perspectives → test first → fix → verify → document → commit + push). `PROGRESS.md` is updated at each step so a cut-off session can resume. Two read-only agents (`bug-investigator`, `fix-reviewer`) support investigation and review. Each write-up starts with the organisers' short note (what's wrong / why / what it breaks). Each fix is pushed to the owner's branch (`ebrahim/track-b`), never to `main`; `.claude/settings.json` blocks main, force and PR commands.
- **Why:** Login first because it is the entry point to everything else; a single status column avoids conflicting copies; checkpoints make the work resumable; the evidence table proves nothing from the sheets is missed.
- **Consequences:** New IDs: DEP-004, BUG-031–036, BUG-051–057 (register below). FP-209 and "refund more than charged" are now bugs of their own (BUG-034, BUG-035) instead of hidden inside FP-300. "Admin actions without role checks" (S4) moves from "later" to Tier 2 (BUG-033).

### D-015 — BUG-037 is an enhancement, not a bug ✅
- **Context:** The investigation found that public signup lets anyone create a shop with an existing user's email; combined with BUG-002 that landed the attacker in the victim's shop.
- **Decision:** After the BUG-002 fix, reclassify it as **ENH-008** (email verification at signup) instead of fixing it as a bug.
- **Why:** The takeover needed BUG-002's email-based identity switch, which is gone: the attacker now gets their own user in their own shop, and the victim's shop still needs the victim's Merchant ID and password. Shared emails across shops are legitimate (the seed has one) and must keep working. What remains, unverified email ownership, is a missing feature, not code that breaks the spec. Rejecting duplicate emails would break legitimate multi-shop users.
- **Consequences:** No code change. Re-check after BUG-031 (OTP exposure) that no other path re-opens it.

### Open decisions ❓
| # | Question | Needed before |
|---|---|---|
| Q-1 | Refund route path: `/v1/refunds` (existing stub) vs `/v1/merchants/:merchantId/refunds` (`initiateMerchantRefund` doc) — check what `apps/web` calls | FP-300 |
| Q-2 | How refunds hit settlement: deduct from the next batch (claim unbatched `refunds` in CloseBatch) vs report-only | FP-300 |
| Q-3 | Payment-link double charge: hold the row lock for the whole pay flow vs keep reservation + safe finalize failure | P2 fix |
| Q-4 | Dilmune Cloud access details and target (compose on a VM?) | Deploy |
| Q-5 | Do we submit the hidden CTF flag, and where? | Any time |

---

## 2. Step log

| # | Date | Step | Result | Based on |
|---|---|---|---|---|
| 1 | 2026-10-29 | Read the challenge brief and the 4 handout sheets; built the first bug hit list | `BRIEF.md` | — |
| 2 | 2026-10-29 | Cloned the reference repo, read all docs, ADRs, incidents, meetings, Slack exports | Found contradictory AI-instruction files | D-001 |
| 3 | 2026-10-29 | Read the git history; decoded the three "transmissions" | Flag `FLAG{order_of_the_prompt_never_read_the_diff}`; hint: fix Yousif's signing branch, abandoned migrations, handover warnings | D-001 |
| 4 | 2026-10-29 | Full code audit of api / settlement / reporting / scripts / migrations / ops | ~60 issues catalogued (§3), FP-300 identified | D-006 |
| 5 | 2026-10-29 | Switched local repo to the submission remote (`origin` = Ananny1, `reference` = MJ5-byte) | Submission = one squashed commit, `.env.docker` removed | D-005 |
| 6 | 2026-10-29 | Wrote this log + decisions | — | D-008 |
| 7 | 2026-10-29 | Replaced poisoned `CLAUDE.md` / `AGENTS.md` / `.cursorrules`; added `docs/challenge/` (GUIDE, PLAN, ANALYSIS, TRAPS, evidence), `docs/bugs/_TEMPLATE.md`, push-deny settings | Fresh clones start with the right rules | D-010, D-011, D-012 |
| 8 | 2026-10-29 | Phase 1: added `ops/Dockerfile.node` (2-stage, argon2 compiles), `ops/Dockerfile.go` (multi-stage, small runtime), `.dockerignore`, `ops/.env.docker.example`; compose loads `env_file`, Postgres bound to `127.0.0.1:5433`; fixed 0054/0055 | Full stack runs locally: migrate 66/66, seed self-checks pass, `/healthz` + `/readyz` ok, API key call returns data | D-007, D-013 |
| 9 | 2026-10-29 | Split the work: Sayed = Track A (security), Ebrahim = Track B (money) then all frontend (Phase F, last). Added `TEAM.md`, `SETUP.md`, a "who are you" step in `CLAUDE.md`; web + admin dashboards run in compose with a Vite `/v1` proxy (the API has no CORS, T-38) | Each person's Claude shows them their own tasks; one command starts all 6 services | — |
| 10 | 2026-10-29 | F0: `/` → dashboard, "Page not found" and "Something went wrong" pages in both dashboards (`docs/bugs/F0-dashboard-routes-and-error-pages.md`) | Checked in headless Chrome: `/` → login, unknown URLs → not-found page | D-003 |
| 11 | 2026-10-29 | BUG-009: `expire_holds` now flips overdue holds to `expired` in one UPDATE instead of select-then-delete (empty id list became `DELETE FROM holds`) | Reproduced 4 → 0 rows; after fix 5/5 tests, all scripts tests 8/8; real run expires 4, deletes 0 | D-003, D-004 |
| 12 | 2026-10-29 | BUG-050: recorded the poisoned agent files as a bug (fixed in step 7); added `scripts/agent_instructions.test.ts` guard; reworded a quoted false rule in `CLAUDE.md` | Guard: originals 0/7, current 7/7; scripts 15/15 | D-001, D-010, D-012 |
| 13 | 2026-10-29 | Re-read the 4 handout sheets; built the Master order (tiers, login first) with evidence coverage; added `WORKFLOW.md`, `PROGRESS.md`, agents `bug-investigator` / `fix-reviewer`, summary block in every write-up; branch-push policy | 6 mismatches fixed (FP-209 and over-refund now bugs, admin role checks raised, `compose up` from `ops/`, short note, ownership/push rules) | D-014 |
| 14 | 2026-10-29 | BUG-058 (found reproducing DEP-004): dev fallback webhook key decoded to 34 bytes; replaced with a valid 32-byte dev-only key | config tests 2 red → 3/3 green; API boots in dev with no key | D-003 |
| 15 | 2026-10-29 | DEP-004: services wait for migrate to finish; committed laptop-only `ops/.env.dev` loaded before the optional `ops/.env.docker` | Fresh clone + new DB: before api/seed/settlement exited (1); after 6 Up, migrate → seed in order, login works; `.env.docker` still overrides | D-003 |
| 16 | 2026-10-29 | DEP-005 (found running T1): Node 20's test runner doesn't expand `src/**/*.test.ts`, so 376 API/reporting tests never ran; images moved to Node 22 LTS | Before: "Could not find", 0 run; after: 443 tests run | D-003 |
| 17 | 2026-10-29 | BUG-050 follow-up: `.dockerignore` kept `.claude/` out of the image, so the guard test failed in Docker; ship `.claude/settings.json` (only). Corrected DEP-005 title (376 tests, not 380) | guard 7/7 inside Docker | D-010 |
| 18 | 2026-10-29 | T1 test baseline recorded (`docs/challenge/TEST-BASELINE.md`): 443 TS tests, 426 pass, 17 fail (3 causes → BUG-059, BUG-060, BUG-061; 1 own guard, fixed); Go all ok | New bugs added to the Master order | D-014 |
| 19 | 2026-10-29 | BUG-001: `lookupSession` now requires `authenticated = true` (the view only filtered revoked/expired) | Pre-OTP cookie: /me and /v1/transactions 200 → 401; OTP login still 200; session tests 5/5; API suite 354/366 (= baseline 12) | D-003 |
| 20 | 2026-10-29 | Ran `bug-investigator` on BUG-002/011/031 (`docs/challenge/investigations/TIER1-login.md`); new BUG-037 (public signup + existing email) | 3 live repros incl. 12 OTP guesses vs limit 5 | D-014 |
| 21 | 2026-10-29 | BUG-002: login binds the OTP and session to the password-checked user, not the first row with that email | Alpha login: /me Beta → Alpha; new tests 2 red → green; API 356/368 (= baseline 12) | D-003 |
| 22 | 2026-10-29 | BUG-037 re-assessed after BUG-002: takeover path closed; reclassified as ENH-008 | — | D-015 |
| D-016 | 2026-10-30 | 4-hour sprint: parallel agent streams in worktrees, one test DB each; one bug = one commit is kept, but shared records are updated by the organiser in batch commits; sprint write-ups use the short form | Only way to cover the 170-point rubric in 4 h; per-stream DBs stop tests colliding |
| D-017 | 2026-10-30 | Merging Sayed's `main` (+ the unique fixes from his 3 branches): where both fixed the same bug, keep Ebrahim's implementation (tested together) and keep Sayed's tests, adapted to rotated session cookies; keep all of Sayed's frontend, theme, AI assistant, CORS, graceful shutdown and readyz; one production stack (ours, HOST-1/HOST-2) | One codebase that passes both sides' tests; no duplicate mechanisms (two load-shedders, two prod stacks) |
| 23 | 2026-10-29 | BUG-031: OTP exposure off by default, refused in production, one switch for reply and log; laptop `.env.dev` opts in; hosted example opts out | Forgotten setting: code in reply+log → none; prod+expose refuses to boot; 5 new tests; API 361/373 (= baseline 12) | D-003 |
| 24 | 2026-10-29 | BUG-011: atomic attempt reservation before comparing, single-winner consume, resend carries the count, `crypto.randomInt` (also payment-link tokens / invite codes); merchant + admin | Live 40 parallel guesses: attempt_count 12/5 → 5/5; 6 new tests red → green; API 367/379 (= baseline 12) | D-003 |
| 25 | 2026-10-29 | BUG-032: rotate the session token at OTP verify and set it with the full TTL (merchant + admin); test helpers take the verify cookie (D-004) | Copied pre-OTP cookie: 200 → 401; merchant cookie 600 s → 43200 s; API 371/383 (= baseline 12) | D-003, D-004 |
| 26 | 2026-10-29 | BUG-010: every admin role views a shop as `support`; `requireMerchantAuth` refuses non-GET on an impersonation grant | Live super-admin view: payment link 201 → 403, saved filter 201 → 403, reads 200; 6 new tests; API 377/389 (= baseline 12) | D-003 |
| 27 | 2026-10-30 | 4-hour sprint (D-016): 9 parallel streams merged by the organiser — 30 bugs (BUG-003…061) + FP-300.1–.4 refunds; worktrees started from old `main`, so every stream was cherry-picked onto `ebrahim/track-b` and re-tested; one test helper updated for BUG-032 | Fresh DB: API 431/432 → 432/432 after the helper fix; reporting 11/11; Go all ok with `-p 1` (packages share one DB; parallel packages race on merchant_balances) | D-016 |
| 28 | 2026-10-30 | Review fixes (BUG-005 one connection per checkout, FP-300.3 recalc keeps refund deduction, BUG-008 queued duplicates, BUG-029 per-day guard, CAP-2 health checks), ENH-001 email OTP, BUG-062 reporting stall | API 450/450, reporting 12/12, Go ok | D-016 |
| 29 | 2026-10-30 | Security sprint: SEC-1…5 built in parallel, integrated, attacked by 4 red-team agents; 4 holes fixed (SEC-RT-1…4), round 2 found SEC-RT-5 (cross-shop report) + SEC-RT-6, fixed by the organiser | API 502/502, reporting 12/12, Go ok | D-016 |
| 30 | 2026-10-30 | Merged Sayed's `main` and 8 unique fixes from his branches (BUG-024, 028, 041→051, 036→052, 037→055, 038, 053, 054); fixed the duplicate-index migration (0076/0098), prod image Node 22 + theme package; HOST-2 per-IP edge limits and capacity re-measure | Fresh DB: 79 migrations; API 550/550, reporting 13/13, Go ok, web tsc/build/tests ok, admin tsc/build ok; prod images build, nginx -t ok; local login end to end ok | D-017 |

---

## 3. Bug register

One row per bug here; the full write-up lives in `docs/bugs/BUG-NNN-name.md` (D-011). Short entry template:

```
### BUG-NNN — <short title>  [severity]  ⬜/⏳/✅
- **Where:** file:line
- **What was wrong:** observable symptom (and which clue/ticket points at it)
- **Why (root cause):** the exact line/logic and why it fails
- **Impact:** who loses what, how badly
- **Fix:** what changed and why it is the minimal correct change
- **Test:** test name/file proving it (fails before, passes after)
- **Decision:** D-xxx
- **Write-up:** docs/bugs/BUG-NNN-name.md
- **Commit:** <hash>
```

Planned queue (from the audit, in fix order):

| ID | Sev | Title | Status |
|---|---|---|---|
| BUG-001 | Critical | Login without OTP (`live_sessions` lookup ignores `authenticated`) → [write-up](docs/bugs/BUG-001-login-without-otp.md) | ✅ |
| BUG-002 | Critical | OTP challenge bound to another merchant's user (lookup by email) → [write-up](docs/bugs/BUG-002-otp-wrong-merchant.md) | ✅ |
| BUG-003 | Critical | Merchant A can cancel merchant B's payment link (IDOR) → [write-up](docs/bugs/BUG-003-payment-link-idor.md) | ✅ |
| BUG-004 | Critical | Expired link payable via client-supplied `submittedAt` (FP-187) → [write-up](docs/bugs/BUG-004-expired-link-payable.md) | ✅ |
| BUG-005 | Critical | Payment link charged twice when capture outlives the 60 s reservation (incident 2026-05-14) → [write-up](docs/bugs/BUG-005-payment-link-charged-twice.md) | ✅ |
| BUG-006 | Critical | Acquirer callbacks not deduplicated (FP-201, reopened) → [write-up](docs/bugs/BUG-006-duplicate-acquirer-callbacks.md) | ✅ |
| BUG-007 | Critical | Acquirer callback signature optional / re-serialised / no freshness → [write-up](docs/bugs/BUG-007-acquirer-callback-signature.md) | ✅ |
| BUG-008 | Critical | Duplicate `settlement.paid` + disbursements (incident 2026-08-21) → [write-up](docs/bugs/BUG-008-duplicate-payout-notifications.md) | ✅ |
| BUG-009 | Critical | `expire_holds` deletes every hold when nothing expired → [write-up](docs/bugs/BUG-009-expire-holds-deletes-all.md) | ✅ |
| BUG-010 | Critical | Impersonation maps super_admin → owner and can write (capture/void/links); must be read-only support → [write-up](docs/bugs/BUG-010-impersonation-owner-and-writes.md) | ✅ |
| BUG-011 | High | OTP attempt limit bypassable in parallel; resend resets it; OTP from `Math.random` (merchant + admin) → [write-up](docs/bugs/BUG-011-otp-guessable.md) | ✅ |
| BUG-012 | High | API key rotation leaves the old key valid → [write-up](docs/bugs/BUG-012-api-key-rotation-keeps-old-key.md) | ✅ |
| BUG-013 | High | Credit two-person check compares display names → [write-up](docs/bugs/BUG-013-credit-self-approval-by-name.md) | ✅ |
| BUG-014 | High | CSV adjustment import parses 2 decimals (4.75 BD → 0.475) → [write-up](docs/bugs/BUG-014-csv-import-10x-off.md) | ✅ |
| BUG-015 | High | Scheme file amount rounded up instead of truncated → [write-up](docs/bugs/BUG-015-scheme-statement-fils-over.md) | ✅ |
| BUG-016 | High | Split payouts lose remainder fils (Delta Marketplace) → [write-up](docs/bugs/BUG-016-split-payouts-lose-fils.md) | ✅ |
| BUG-017 | High | "Rebuild cached balances" reads scheme lines, not the ledger (FP-203) → [write-up](docs/bugs/BUG-017-rebuild-balances-reads-export.md) | ✅ |
| BUG-018 | High | MDR recalculation rewrites paid batches → [write-up](docs/bugs/BUG-018-mdr-recalc-rewrites-paid-batches.md) | ✅ |
| BUG-019 | High | Recompute statuses clears `test_mode` → test merchants settled → [write-up](docs/bugs/BUG-019-recompute-clears-test-mode.md) | ✅ |
| BUG-020 | High | Daily close at 03:00 Bahrain (UTC day used) → [write-up](docs/bugs/BUG-020-daily-close-at-0300-bahrain.md) | ✅ |
| BUG-021 | High | Net payout computed in float32 → [write-up](docs/bugs/BUG-021-net-payout-float32.md) | ✅ |
| BUG-022 | High | Platform volume counter int32 overflow → [write-up](docs/bugs/BUG-022-platform-volume-int32-overflow.md) | ✅ |
| BUG-023 | High | Outbound webhook signs canonical JSON but sends different bytes (FP-240) → [write-up](docs/bugs/BUG-023-webhook-signs-different-bytes.md) | ✅ |
| BUG-024 | Medium | Settlement summary double-counts multi-capture merchants; slow | ⬜ |
| BUG-025 | Medium | Export loads all rows in memory; streaming variant skips rows | ⬜ |
| BUG-026 | Medium | Dashboard fee uses latest-entered schedule, not effective one (245 vs 225) → [write-up](docs/bugs/BUG-026-fee-display-245-vs-225.md) | ✅ |
| BUG-027 | Medium | March sweep script not idempotent, wrong window, wrong account → [write-up](docs/bugs/BUG-027-march-sweep-not-idempotent.md) | ✅ |
| BUG-028 | Medium | Lifetime payout estimate stored as REAL (drift) | ⬜ |
| BUG-029 | Medium | Adjustment import has no double-submit guard → [write-up](docs/bugs/BUG-029-adjustment-import-double-submit.md) | ✅ |
| BUG-030 | Medium | CSV export formula injection → [write-up](docs/bugs/BUG-030-csv-export-formula-injection.md) | ✅ |
| DEP-001 | Blocker | Missing `ops/Dockerfile.node` / `Dockerfile.go` | ✅ |
| DEP-002 | Blocker | Migration 0054 fails on a fresh database | ✅ |
| DEP-003 | Blocker | Compose never loads service env (API boots in dev mode) | ✅ |
| FP-300 | Feature | Refunds end to end (fixes R1–R9 inside) | ⬜ |
| DEP-005 | High | `npm test` never ran the API/reporting suites on Node 20 (glob not expanded) → [write-up](docs/bugs/DEP-005-tests-never-ran-on-node20.md) | ✅ |
| DEP-004 | High | `docker compose up` from `ops/` (the brief's instruction) fails on a fresh clone → [write-up](docs/bugs/DEP-004-compose-up-from-ops.md) | ✅ |
| BUG-031 | Critical | OTP code returned in the login reply and logged (`otpDevExpose` defaults on) → [write-up](docs/bugs/BUG-031-otp-exposed-in-reply-and-logs.md) | ✅ |
| BUG-032 | Medium | Session token not rotated after OTP (fixation, merchant + admin); merchant cookie kept the 10-min pending lifetime → [write-up](docs/bugs/BUG-032-session-fixation.md) | ✅ |
| BUG-033 | High | Admin actions missing role checks (audit every `/v1/admin` route) → [write-up](docs/bugs/BUG-033-admin-route-role-audit.md) | ✅ |
| BUG-034 | Critical | Two refunds at once both succeed (FP-209) → [write-up](docs/bugs/BUG-034-concurrent-refunds.md) | ✅ |
| BUG-035 | Critical | Refund more than was captured → [write-up](docs/bugs/BUG-035-refund-more-than-captured.md) | ✅ |
| BUG-036 | Critical | Refund another merchant's transaction → [write-up](docs/bugs/BUG-036-refund-other-merchant.md) | ✅ |
| BUG-051 | High | Scheme rounding residue never posted (ADR-0002) | ⬜ |
| BUG-052 | High | Capture fee ignores the negotiated discount that settlement applies | ⬜ |
| BUG-053 | Medium | Split child without a balance row → payout is a no-op | ⬜ |
| BUG-054 | Medium | Reconciliation uses `merchants.mdr_bps` (no sync trigger exists) | ⬜ |
| BUG-055 | Medium | Rollups / metrics / analytics bucketed by UTC date | ⬜ |
| BUG-056 | High | Refund fee reversal across partials can exceed the original fee → [write-up](docs/bugs/BUG-056-refund-fee-reversal-sum.md) | ✅ |
| BUG-057 | Medium | Status after a full refund of a partial capture | ⬜ |
| BUG-058 | High | Built-in dev webhook key is 34 bytes → API and seed crash in dev → [write-up](docs/bugs/BUG-058-dev-webhook-key-invalid.md) | ✅ |
| BUG-059 | High | Reporting consumer writes `merchant_id = NULL` (4 reporting tests red at T1) → [write-up](docs/bugs/BUG-059-reporting-null-merchant-from-test-fixture.md) | ✅ |
| BUG-060 | Medium | Webhook retry backoff differs from config (API test 332 red at T1) → [write-up](docs/bugs/BUG-060-webhook-backoff-jitter-and-cap.md) | ✅ |
| BUG-061 | High | Refund insert violates `chk_refunds_reason_not_null` (11 refund tests red at T1; R8) → [write-up](docs/bugs/BUG-061-refund-reason-null.md) | ✅ |
| BUG-062 | High | Reporting worker crashes (and stalls for everyone) when a closed batch's day has captures but no rollup row → [write-up](docs/bugs/BUG-062-reporting-stalls-on-missing-rollup.md) | ✅ |
| SEC-1 | High | Login/OTP brute force: no limit per IP or account → 5/min per IP+account, 30/min per IP, 15-min lockout, state in Postgres → [write-up](docs/bugs/SEC-1-login-brute-force-limiter.md) | ✅ |
| SEC-2 | Medium | No idle timeout: an open dashboard stayed logged in 12 h → 60 min shops / 30 min staff, throttled last_seen → [write-up](docs/bugs/SEC-2-idle-session-timeout.md) | ✅ |
| SEC-3 | Medium | No security headers; 500s leaked internals; no body/time limits → [write-up](docs/bugs/SEC-3-security-headers-errors-limits.md) | ✅ |
| SEC-4 | High | KYC documents stored in plaintext; leaked acquirer secret still accepted in production → [write-up](docs/bugs/SEC-4-kyc-encrypted-at-rest.md) | ✅ |
| SEC-5 | High | No edge rate/connection limits (DDoS) → nginx per-IP rules → [write-up](docs/bugs/SEC-5-edge-rate-limits.md) | ✅ |
| SEC-RT-1 | Medium | Disabled admin kept a working view-as-merchant grant (red team) → [write-up](docs/bugs/SEC-RT-1-disabled-admin-impersonation.md) | ✅ |
| SEC-RT-2 | Medium | Suspended/closed merchant kept live dashboard sessions (red team) → [write-up](docs/bugs/SEC-RT-2-suspended-merchant-session.md) | ✅ |
| SEC-RT-3 | Medium | GET /v1/reporting/export-summary had no auth (red team) → [write-up](docs/bugs/SEC-RT-3-export-summary-no-auth.md) | ✅ |
| SEC-RT-4 | Medium | Public payment-link page leaked the merchant API key hash and prefix (red team) → [write-up](docs/bugs/SEC-RT-4-public-link-leaks-api-key-hash.md) | ✅ |
| SEC-RT-5 | High | Any shop could read a marketplace child shop's transaction report (red team, round 2) → [write-up](docs/bugs/SEC-RT-5-report-reads-other-shops-split-child.md) | ✅ |
| SEC-RT-6 | Low | Malformed ids/dates crashed requests with 500 (red team) → [write-up](docs/bugs/SEC-RT-6-bad-input-500.md) | ✅ |
| BUG-037 | — | Public signup accepts an existing user's email. ⏭ Reclassified as **ENH-008** (D-015) | ⏭ |
| BUG-050 | Critical | AI instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`) told agents to keep the bugs → [write-up](docs/bugs/BUG-050-poisoned-agent-instructions.md) | ✅ |

---

## 3b. Enhancement register

Enhancements are **not bugs**: improvements beyond the spec, done only after approval, each in its
own commit with a write-up in `docs/enhancements/` (template `_TEMPLATE.md`). The list with
reasons and cost is in `docs/challenge/PLAN.md` → Enhancements.

| ID | Title | Supports | Status |
|---|---|---|---|
| ENH-001 | Email OTP delivery: "chattrix" = Gmail SMTP + app password (free), Mailpit locally → [write-up](docs/enhancements/ENH-001-email-otp-chattrix.md) | BUG-031 | ✅ |
| ENH-002 | Authenticator-app (TOTP) second factor | Tier 1 | 💡 |
| ENH-003 | CORS allowlist for production | F12, DEPLOY | 💡 |
| ENH-004 | Make `sqlFilter` refuse empty filters or delete it | BUG-009 | 💡 |
| ENH-005 | Rate limiting on login / OTP resend → done as SEC-1 | BUG-011 | ✅ |
| ENH-006 | Per-service DB roles + TLS | D5 | 💡 |
| ENH-008 | Email verification at signup | BUG-037 | 💡 |
| ENH-009 | AI assistant limits: 6/min and 100/day per merchant, key only in git-ignored env files → [write-up](docs/enhancements/ENH-009-assistant-usage-limits.md) | Sayed's assistant | ✅ |
| ENH-010 | AI assistant guardrails: input validation, topic gate (fails closed), scoped prompt, token budgets per session/day → [write-up](docs/enhancements/ENH-010-assistant-guardrails.md) | Sayed's assistant | ✅ |
| ENH-007 | Deleted now-unused `apps/api/src/auth/users.ts` (`findOtpRecipient`, the cross-shop email lookup behind BUG-002); approved by Ebrahim 2026-10-30 | BUG-002 | ✅ |

## 4. FP-300 progress

| Done when | Status | Notes |
|---|---|---|
| Works end to end through the API | ⬜ | Q-1 |
| Money right in the ledger, to the fil | ⬜ | |
| Fees and payouts right | ⬜ | Q-2 |
| Shop gets the right webhook | ⬜ | envelope case before eligible list |
| Timeline, reports, reconciliation | ⬜ | fix 0072 join |
| Live on Dilmune Cloud | ⬜ | Q-4 |
