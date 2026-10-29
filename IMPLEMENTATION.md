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
| BUG-001 | Critical | Login without OTP (`live_sessions` lookup ignores `authenticated`) | ⬜ |
| BUG-002 | Critical | OTP challenge bound to another merchant's user (lookup by email) | ⬜ |
| BUG-003 | Critical | Merchant A can cancel merchant B's payment link (IDOR) | ⬜ |
| BUG-004 | Critical | Expired link payable via client-supplied `submittedAt` (FP-187) | ⬜ |
| BUG-005 | Critical | Payment link charged twice when capture outlives the 60 s reservation (incident 2026-05-14) | ⬜ |
| BUG-006 | Critical | Acquirer callbacks not deduplicated (FP-201, reopened) | ⬜ |
| BUG-007 | Critical | Acquirer callback signature optional / re-serialised / no freshness | ⬜ |
| BUG-008 | Critical | Duplicate `settlement.paid` + disbursements (incident 2026-08-21) | ⬜ |
| BUG-009 | Critical | `expire_holds` deletes every hold when nothing expired | ⬜ |
| BUG-010 | Critical | Impersonation maps super_admin → owner (must be read-only support) | ⬜ |
| BUG-011 | High | OTP attempt limit bypassable in parallel; OTP from `Math.random` | ⬜ |
| BUG-012 | High | API key rotation leaves the old key valid | ⬜ |
| BUG-013 | High | Credit two-person check compares display names | ⬜ |
| BUG-014 | High | CSV adjustment import parses 2 decimals (4.75 BD → 0.475) | ⬜ |
| BUG-015 | High | Scheme file amount rounded up instead of truncated | ⬜ |
| BUG-016 | High | Split payouts lose remainder fils (Delta Marketplace) | ⬜ |
| BUG-017 | High | "Rebuild cached balances" reads scheme lines, not the ledger (FP-203) | ⬜ |
| BUG-018 | High | MDR recalculation rewrites paid batches | ⬜ |
| BUG-019 | High | Recompute statuses clears `test_mode` → test merchants settled | ⬜ |
| BUG-020 | High | Daily close at 03:00 Bahrain (UTC day used) | ⬜ |
| BUG-021 | High | Net payout computed in float32 | ⬜ |
| BUG-022 | High | Platform volume counter int32 overflow | ⬜ |
| BUG-023 | High | Outbound webhook signs canonical JSON but sends different bytes (FP-240) | ⬜ |
| BUG-024 | Medium | Settlement summary double-counts multi-capture merchants; slow | ⬜ |
| BUG-025 | Medium | Export loads all rows in memory; streaming variant skips rows | ⬜ |
| BUG-026 | Medium | Dashboard fee uses latest-entered schedule, not effective one (245 vs 225) | ⬜ |
| BUG-027 | Medium | March sweep script not idempotent, wrong window, wrong account | ⬜ |
| BUG-028 | Medium | Lifetime payout estimate stored as REAL (drift) | ⬜ |
| BUG-029 | Medium | Adjustment import has no double-submit guard | ⬜ |
| BUG-030 | Medium | CSV export formula injection | ⬜ |
| DEP-001 | Blocker | Missing `ops/Dockerfile.node` / `Dockerfile.go` | ✅ |
| DEP-002 | Blocker | Migration 0054 fails on a fresh database | ✅ |
| DEP-003 | Blocker | Compose never loads service env (API boots in dev mode) | ⬜ |
| FP-300 | Feature | Refunds end to end (fixes R1–R9 inside) | ⬜ |

---

## 4. FP-300 progress

| Done when | Status | Notes |
|---|---|---|
| Works end to end through the API | ⬜ | Q-1 |
| Money right in the ledger, to the fil | ⬜ | |
| Fees and payouts right | ⬜ | Q-2 |
| Shop gets the right webhook | ⬜ | envelope case before eligible list |
| Timeline, reports, reconciliation | ⬜ | fix 0072 join |
| Live on Dilmune Cloud | ⬜ | Q-4 |
