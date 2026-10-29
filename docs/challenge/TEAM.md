# Team — who does what

| Person | Git name | Role | Task list |
|---|---|---|---|
| **Ebrahim** | `ealnasser` | **Track B** "Is the money right" (money + Go settlement), then **all frontend / UI / UX** (last) | `PLAN.md` → Track B, FP-300 (B steps), Phase F |
| **Sayed** | — | **Track A** "Who can get in" (security in `apps/api`) | `PLAN.md` → Track A, FP-300 (A steps) |

Shared: Phase 6 deploy (whoever finishes first; the other reviews).

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
BUG-012 → BUG-013 → A5 → BUG-025/030 → BUG-026 (see `PLAN.md` → Track A).

**FP-300 (later):** steps 1, 2, 3, 5, 6, 11 (route, locking, validation, state, ledger, tests).

**Your numbers:** new migrations **0073–0079** · new bugs **BUG-031–049**.

## Ebrahim — Track B: "Is the money right", then frontend

**Your area:** `apps/settlement/` (Go), `scripts/`, admin money tools in `apps/api/src/admin/`,
outbound webhooks (`apps/api/src/webhooks/dispatcher.ts`, `sign.ts`), `apps/api/src/payments/capture.ts`.

**Your first bug:** **BUG-009 — `expire_holds` deletes every hold when nothing expired.**
`scripts/expire_holds.ts` + `scripts/lib/sqlFilter.ts`: an empty filter list is skipped, so the query
becomes `DELETE FROM holds` with no `WHERE`. HANDOVER: holds are never deleted, only flipped to
`expired`. Details: `ANALYSIS.md` §3.6 B6.

**Then, in order:** BUG-014 → BUG-020 → BUG-015 → BUG-016 → BUG-017 → BUG-018 → BUG-019 → BUG-008 →
BUG-023 → BUG-021/022/028 → BUG-027/029 → BUG-024 → the rest (see `PLAN.md` → Track B).

**FP-300 (later):** steps 4, 7, 8, 10 (fee reversal, settlement batch, webhook, reports).

**Frontend (last, after the backend fixes it depends on):** `PLAN.md` → Phase F: refund drawer and
timeline, checkout, login pages, impersonation view, amounts in BD with 3 decimals, UI/UX pass.
Frontend lives in `apps/web/` (shop dashboard + checkout, port 5173) and `apps/admin/` (staff
console, port 5174). Both run in Docker with live reload.

**Your numbers:** new migrations **0080–0089** · new bugs **BUG-050–069**.

---

## How we work together

1. **First time:** follow `SETUP.md` (Docker, migrate, seed, logins).
2. **Before each bug:** `git pull --rebase origin main`.
3. **Each bug:** failing test → small fix → test passes → write-up `docs/bugs/BUG-NNN-*.md`
   → your rows in `IMPLEMENTATION.md` and `PLAN.md` → **one commit for that bug only**.
4. **After each commit:** push yourself (Claude never pushes), so your mate gets it.
5. **Only edit your own rows** in shared files. Ask before touching the other track's files.
6. **Found a trap?** Add it to `TRAPS.md` and tell your mate.
