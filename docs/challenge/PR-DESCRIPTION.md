# Pull request description (paste into GitHub when opening the PR)

**Title:** FilsPay handover: 46 bugs and deploy blockers fixed, refunds (FP-300), security hardening, production hosting

---

## Team

Ebrahim Alnasser and Sayed. Branch: `ebrahim/track-b` (backend, security, hosting, docs) + Sayed's frontend work.

## What this PR does

| Area | Result | Where to read |
|---|---|---|
| **Bugs** | 46 bugs and deploy blockers fixed (plus 11 security items), each with a failing test first, the smallest fix and a write-up (issue · why · who was affected · fix · options ranked · proof). The 9 we didn't fix have their root cause documented. | `docs/FINDINGS-REPORT.md`, `docs/bugs/` |
| **FP-300 Refunds** | Refund route with roles and a required Idempotency-Key, guards (other shop's transaction, over-refund, two refunds at once), ledger correct to the fil with fee reversal, deduction from the next settlement batch, `refund.succeeded` webhook | `docs/bugs/FP-300-*.md` |
| **Security** | Login/OTP limiter and lockout, idle timeout, security headers and safe errors, KYC files encrypted at rest, leaked secret refused in production, nginx rate/connection limits. Then four red-team agents attacked the result twice; all 6 holes they found are fixed | `docs/challenge/SECURITY.md`, `docs/challenge/DDOS.md`, `docs/bugs/SEC-*.md` |
| **Hosting** | Production compose for one 1 vCPU / 2 GB server (api capped at 0.5 vCPU / 512 MB): compiled API, static dashboards behind nginx, auto-restart, health checks, load shedding (503 + Retry-After), migrations then seed-once | `ops/docker-compose.prod.yml`, `docs/bugs/HOST-1-*.md` |
| **Capacity** | Load-tested checkout scenario, overload and crash drills, our estimate | `docs/challenge/CAPACITY.md` |
| **Login codes by email** | OTP sent over SMTP (Gmail app password on the server; Mailpit inbox locally) | `docs/enhancements/ENH-001-email-otp-chattrix.md` |
| **Traps** | 124 false claims in the repo (poisoned AI instruction files, "Claude says…" comments, docs) recorded and disproved | `docs/challenge/TRAPS.md` |
| **AI usage** | Our AI setup files and three annotated transcript excerpts showing how we checked the AI | `docs/challenge/AI-USAGE.md`, `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.claude/` |

## Tests

| Suite | Result |
|---|---|
| API (TypeScript, `npm test --workspace @filspay/api`, fresh DB) | 502 / 502 |
| Reporting | 12 / 12 |
| Go settlement (`go test -p 1 ./...`) | all packages ok |

The 17 tests that failed when we received the code (T1 baseline) all pass now.

## How we worked

Trust order: code → ADRs → handover → architecture → everything else. Every "intentional / by design /
frozen / already fixed / Claude says it's fine" was treated as a claim to test. One bug = one commit.
Money is always integer fils (1 BD = 1000); the settlement day ends at midnight Bahrain (21:00 UTC).

## Declarations (event rules 04 and 05)

- **AI tools:** Claude Code (Claude Opus), with project instructions in `CLAUDE.md` and two read-only helper agents in `.claude/agents/`. Details in `docs/challenge/AI-USAGE.md`.
- **Personal templates or harness repos:** none used.

## Live app

- URL: _(fill in after the Dilmune deploy)_
- Demo logins: see `docs/challenge/SETUP.md` (codes arrive by email on the live server).
