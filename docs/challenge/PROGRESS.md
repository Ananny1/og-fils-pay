# Progress — live checkpoint

Updated at every step of `WORKFLOW.md`. If a session is cut off, the next one starts here.
Status of all tasks: `PLAN.md` → Master order. This file is the **detail of what's happening now**.

## Now

| Field | Value |
|---|---|
| Task | — |
| Owner | — |
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
| 2026-10-29 | BUG-050 poisoned agent files (write-up + guard test) | `dd4f262` | `ebrahim/track-b` (pending) |
| 2026-10-29 | BUG-009 expire_holds deletes all | `815b07a` | `ebrahim/track-b` (pending) |
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
| Q-7 | Should the seed run automatically on `docker compose up` on the hosted box (it resets demo data each start)? | DEP-004, DEPLOY | Local: yes. Hosted: only on first start |

## Ideas for later

| Idea | From task | Why not now |
|---|---|---|
| Email OTP delivery (SMTP + Mailpit locally); possibly reuse "chattrix" | BUG-031 | A new feature, not the minimal fix; needs Q-6 |
| Authenticator-app (TOTP) second factor | BUG-031 | Rewrite; doesn't fix BUG-001/002/011 |
| Make `scripts/lib/sqlFilter.ts` refuse an empty filter (or delete it, now unused) | BUG-009 | Not needed for the fix |
