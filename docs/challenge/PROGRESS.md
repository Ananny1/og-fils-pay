# Progress — live checkpoint

Updated at every step of `WORKFLOW.md`. If a session is cut off, the next one starts here.
Status of all tasks: `PLAN.md` → Master order. This file is the **detail of what's happening now**.

## Now

| Field | Value |
|---|---|
| Task | Tier 2 next: BUG-003 payment link IDOR |
| Owner | Ebrahim |
| Branch | `ebrahim/track-b` |
| Step | — (0-claimed · 1-understood · 2-planned · 3-test-red · 4-fixed · 5-verified · 6-documented · 7-pushed) |
| Changed files (not committed yet) | — |
| Root cause (one line) | — |
| Chosen option | — |

### Notes for the current task

—

## Done (newest first)

| Date | Task | Commit | Pushed to |
|---|---|---|---|
| 2026-10-29 | BUG-010 impersonation owner powers + writes | (this commit) | `ebrahim/track-b` |
| 2026-10-29 | BUG-032 session fixation + 10-min logouts | `765c69f` | `ebrahim/track-b` |
| 2026-10-29 | BUG-011 OTP guessable (merchant + admin) | `67ac85e` | `ebrahim/track-b` |
| 2026-10-29 | BUG-031 OTP in reply and logs | `cc456c7` | `ebrahim/track-b` |
| 2026-10-29 | BUG-037 reclassified → ENH-008 (D-015) | `eba1a78` | `ebrahim/track-b` |
| 2026-10-29 | BUG-002 OTP lands in another shop | `d9c7afd` | `ebrahim/track-b` |
| 2026-10-29 | BUG-001 login without OTP | `c409a21` | `ebrahim/track-b` |
| 2026-10-29 | T1 test baseline | `6f87076` | `ebrahim/track-b` |
| 2026-10-29 | BUG-050 follow-up: guard runs in Docker | `9d209d7` | `ebrahim/track-b` |
| 2026-10-29 | DEP-005 tests never ran on Node 20 | `a57fdce` | `ebrahim/track-b` |
| 2026-10-29 | DEP-004 compose up from ops/ | `b03fb25` | `ebrahim/track-b` |
| 2026-10-29 | BUG-058 dev webhook key 34 bytes | `113547f` | `ebrahim/track-b` |
| 2026-10-29 | BUG-050 poisoned agent files (write-up + guard test) | `dd4f262` | `ebrahim/track-b` ✅ |
| 2026-10-29 | BUG-009 expire_holds deletes all | `815b07a` | `ebrahim/track-b` ✅ |
| 2026-10-29 | F0 dashboard routes + error pages | `dfc5efb` | `main` |
| 2026-10-29 | DEP-003 service settings | `02e2646` | `main` |
| 2026-10-29 | DEP-002 fresh migrate | `15eecb7` | `main` |
| 2026-10-29 | DEP-001 Dockerfiles | `d739d01` | `main` |

## Questions for Ebrahim (answer when back)

| # | Question | Blocks | My default if no answer |
|---|---|---|---|
| Q-6 | "Chattrix" from your earlier projects: what is it (mail sender? chat/notification service?) and may FilsPay use it to deliver OTP codes? | BUG-031 follow-up (OTP delivery) | Fix the leak now; log the OTP server-side only in dev; delivery stays a stub |
| Q-1 | Refund route: `/v1/refunds` (existing stub the web client calls?) or `/v1/merchants/:id/refunds` | FP-300.1 | Use whatever `apps/web/src/api/transactions.ts` calls |
| Q-2 | Refunds in settlement: deduct from the next batch, or report-only | FP-300.3 | Deduct from the next batch (sheet S2 "payouts come out right") |
| Q-4 | Dilmune Cloud access (host, login, how apps are deployed) | DEPLOY | Prepare everything; deploy when access arrives |
| Q-5 | Submit the hidden flag `FLAG{order_of_the_prompt_never_read_the_diff}`? Where? | — | Keep it documented in GUIDE/IMPLEMENTATION |
| Q-8 | Docker's build cache holds ~4 GB (mostly other projects); disk is at 99%. OK to run `docker builder prune`? | Builds may fail on a full disk | Don't touch it; clean only FilsPay's own leftovers |
| Q-7 | Should the seed run automatically on `docker compose up` on the hosted box (it resets demo data each start)? | DEP-004, DEPLOY | Local: yes. Hosted: only on first start |

## Ideas for later

New ideas land here first. When Ebrahim approves one it becomes an `ENH-NNN` in `PLAN.md` →
Enhancements (ENH-001 … ENH-006 already moved there).

| Idea | From task | Why not now |
|---|---|---|
| — | | |
