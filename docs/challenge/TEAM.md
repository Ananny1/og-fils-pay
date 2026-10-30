# Team og — who does what

| Person | Git name | Role (final) | Branch |
|---|---|---|---|
| **Ebrahim Alnasser** | `ealnasser` | Backend: bug fixes and root causes, security and red team, refunds (FP-300), email OTP, AI assistant limits, capacity, AI setup | `ebrahim/track-b` |
| **Sayed Hassan Isa** | `Ananny1` | Frontend (since 2026-10-30): redesign and theme, "Ask FilsPay" assistant, second bug pass (BUG-064–109), production deployment on Dilmune | fork `main` |

The sections below are the plan as it was at the start; the final split is the table above.

## How we kept each other in sync (corrected agent files)

The original `CLAUDE.md`, `AGENTS.md` and `.cursorrules` were poisoned (BUG-050). We replaced them
with the team's real rules, so both of our AI sessions read the same instructions and the same
shared files:

| File | What it tells the other person (and their AI) |
|---|---|
| `CLAUDE.md`, `AGENTS.md`, `.cursorrules` | The real rules; asks who is working and shows that person their own tasks |
| `docs/challenge/TEAM.md` (this file) | Who owns what; notes for Sayed on backend changes touching his side |
| `docs/challenge/PLAN.md`, `PROGRESS.md` | Every task with its status; what is in progress right now |
| `SAYED-BUGS.md`, `docs/bugs/README.md` | Sayed's bug list; the bug-number map so we never reuse a number |
| `docs/challenge/DEPLOYMENT.md` | Live links and how a merge reaches the server |

**Claiming:** before starting a task, mark it ⏳ with your name in the Master order and in
`PROGRESS.md`, commit and push that line. Never start a task someone else has marked ⏳.

The task status (⬜ ⏳ ✅) lives only in `PLAN.md`. This file says **who** and **how**.

---

## Sayed — Track A: "Who can get in"

**Your area:** `apps/api/src/` — login/OTP, sessions, permissions, payment links, acquirer callbacks,
API keys, exports. TypeScript (Fastify + Postgres).

**Your first bug:** **BUG-001 — login works without the OTP.**
`apps/api/src/auth/sessions.ts` `lookupSession` uses the `live_sessions` view (0058), which doesn't
check `authenticated = true`. So the half-logged-in cookie you get after the password (before the OTP)
already works as a full session. Details: `ANALYSIS.md` §3.1 A1.

**Then, in order:** BUG-002 → BUG-003 → BUG-010 → BUG-004 → BUG-005 → BUG-006 → BUG-007 → BUG-011 →
BUG-012 → BUG-013 → A5 → BUG-025/030 → BUG-026 → BUG-023 → BUG-024 → BUG-029 (see `PLAN.md` → Track A).
Also **T3**: an API smoke script for the demo.

**FP-300 (later):** steps 1, 2, 3, 5, 6, 11 (route, locking, validation, state, ledger, tests).

**Your numbers:** new migrations **0073–0079** · new bugs **BUG-031–049**.

## Ebrahim — Track B: "Is the money right", then frontend

**Your area:** `apps/settlement/` (Go), `scripts/`, admin money tools in `apps/api/src/admin/`,
payout effects in `apps/api/src/webhooks/dispatcher.ts` (W6; Sayed owns its send/sign path), `apps/api/src/payments/capture.ts`,
and all frontend (`apps/web`, `apps/admin`).

**Your first bug:** **BUG-009 — `expire_holds` deletes every hold when nothing expired.**
`scripts/expire_holds.ts` + `scripts/lib/sqlFilter.ts`: an empty filter list is skipped, so the query
becomes `DELETE FROM holds` with no `WHERE`. HANDOVER: holds are never deleted, only flipped to
`expired`. Details: `ANALYSIS.md` §3.6 B6.

**Then, in order:** BUG-014 → BUG-020 → BUG-015 → BUG-016 → BUG-017 → BUG-018 → BUG-019 → BUG-008 →
BUG-021/022/028 → BUG-027 → the rest (see `PLAN.md` → Track B).

**FP-300 (later):** steps 4, 7, 8, 10 (fee reversal, settlement batch, webhook, reports).

**Frontend (last, after the backend fixes it depends on):** `PLAN.md` → Phase F: F1–F12 fixes plus
the **page checklist** (every page × loading / empty / error / 403 / 401 / not found / 3-decimal
amounts / mobile). F0 (home URL + not-found and error pages) is done. Also T4 (frontend tests)
and T5 (checklist ticked in the browser).
Frontend lives in `apps/web/` (shop dashboard + checkout, port 5173) and `apps/admin/` (staff
console, port 5174). Both run in Docker with live reload.

**Your numbers:** new migrations **0080–0089** · new bugs **BUG-050–069**.

---

## How we work together

1. **First time:** follow `SETUP.md` (Docker, migrate, seed, logins).
2. **Before each bug:** on your branch, `git pull --rebase origin main`. The full per-task steps are in `WORKFLOW.md`.
3. **Each bug:** failing test → small fix → test passes → write-up `docs/bugs/BUG-NNN-*.md`
   → your rows in `IMPLEMENTATION.md` and `PLAN.md` → **one commit for that bug only**.
4. **After each commit:** push **your own branch** (Claude may push it for you when you've asked;
   never `main`). Merge into `main` through GitHub with a normal or rebase merge, never squash.
5. **Only edit your own rows** in shared files. Ask before touching the other track's files.
6. **Found a trap?** Add it to `TRAPS.md` and tell your mate.

## For Sayed (frontend) — what the backend sprint touched on your side (2026-10-30)

| Change | Files | Why |
|---|---|---|
| Checkout no longer sends `submittedAt` | `apps/web/src/pages/checkout/CheckoutPage.tsx`, `apps/web/src/api/paymentLinks.ts` (2 lines) | BUG-004: the server now decides link expiry |
| Admin router `basename` from `BASE_URL` | `apps/admin/src/router.tsx` | HOST-1: the hosted build serves the console under `/admin` |
| Refund route is `POST /v1/merchants/:merchantId/refunds` | (API) | FP-300.1: matches the existing `RefundDrawer` — you can wire the drawer now |
| Settlement batch net can now be `gross − fee − refunds` | (API) | FP-300.3: the comment in `apps/web/src/types.ts` ("always gross − fee") is out of date |
| **Not merged:** screen fixes F4 (read-only banner), F5 (negative amounts), F9 (tab titles), F10 (no double-click) | branch `worktree-wf_927692e7-c3a-10` | Built by an agent; yours to take or drop. "Before" screenshots are in `docs/challenge/ux/before/` |

## Migration numbers used in the sprint

0084–0087 and 0090 (bug streams), 0098 (CAP-3), security stream 0073–0079. Next free numbers: 0080–0083, 0088–0089, 0091–0097.
