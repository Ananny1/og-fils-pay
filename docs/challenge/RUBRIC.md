# How we're judged (170 points) and what we do for each

Source: the organisers' rubric (`evidence/05-judging-rubric.png`). **Read this before planning any
work.** Every task in `PLAN.md` should earn points in one of these rows.

| Area | Points | What the judges do | What it means for us | Tasks |
|---|---|---|---|---|
| **Correctness** | **100** | Load testing, a security review, **hidden regression tests**, and a written **findings report** explaining the root cause of each problem | Fix the real bugs so their hidden tests pass; every fix has a write-up whose "why" is the root cause, in plain words | Tiers 1–6, REPORT |
| **Capacity** | 20 | Load test the **live server** with a fixed **checkout** scenario: how many users it serves while staying fast and correct. **We send an estimate first** (an accurate one earns points). Then they push past the limit: does the stack **turn away the excess, restart itself, and recover without losing data**? | Measure ourselves first; refuse extra load quickly (429/503) instead of falling over; restart policies and health checks; no data lost (Postgres volume, transactions, idempotency) | CAP-1 … CAP-4 |
| **Hosting architecture** | 10 | **Live, secure, reproducible.** The whole stack on **one server, 1 vCPU and 2 GB RAM**; the **API limited to 0.5 vCPU and 512 MB** | Resource limits in compose; production builds (no Vite dev servers, no tsx at runtime); only the web ports public; one command rebuilds everything | HOST-1, D4/D5/D7, DEPLOY |
| **AI usage and setup** | 10 | AI setup files in the repo + **3 annotated transcript excerpts** in the submission document. "We care about **how you checked what the AI told you**, not how much you used it." | Keep `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.claude/agents/`, `.claude/settings.json`; collect moments where we **caught the AI being wrong** | AI-1 |
| **UI and UX** | 10 | Checkout, the merchant dashboard and the admin console. **Bring before and after evidence.** | Take "before" screenshots **before** touching any screen; same shots after | UX-0, Tier 7 |
| **Technical defence** | 20 | The whole team meets the judges. We present from **our slide deck**; the judges ask questions and **choose who answers**. Anything we can't explain or show working doesn't score. | **Both Ebrahim and Sayed** must be able to explain every fix; a live demo; slides | DEF-1, `PRESENTATION.md` |

## Current gaps (checked 2026-10-30)

| Gap | Where | Hurts |
|---|---|---|
| No `restart:` policy on any service | `ops/docker-compose.yml` | Capacity ("restarts itself") |
| No CPU / memory limits (the API must be 0.5 vCPU / 512 MB) | `ops/docker-compose.yml` | Hosting |
| The API runs through `tsx` (compiles at start, more memory); web and admin run **Vite dev servers** | compose `command:` | Hosting, Capacity |
| No load shedding: under overload, requests queue on a 5-connection DB pool until they time out | `apps/api/src/app.ts`, `db/pool.ts` | Capacity ("turns away the excess") |
| No measured capacity number yet | — | Capacity (estimate) |
| No "before" screenshots yet (F0 already changed the routes; its write-up has the before) | — | UI/UX |

## AI-usage excerpts we already have (candidates for the 3)

Each one shows **checking** the AI, which is what is scored:

1. **The poisoned instruction files (BUG-050).** The repo's own `CLAUDE.md` told the AI that money is cents and the day ends at UTC midnight. We checked them against ADR-0001 and the brief, replaced the files, and added a guard test. The guard then **caught our own AI-written `CLAUDE.md`** quoting a false rule word for word, and we reworded it.
2. **"Claude says" comments in the code.** One was a real bug (T-34, timezone), one was a decoy in dead code (T-35), one was wrong (T-44, "authenticated is redundant" → login without OTP, BUG-001). Same source, three different truths: only the code decides.
3. **The AI's own numbers, verified.** The AI estimated 4 GB of Docker cache (only 0.5 GB was freed), and a commit title said 380 tests (the real count was 376, corrected in the next commit). We trust measurements, not the AI's estimates.

Add better ones as they happen (e.g. an AI fix that a test proved wrong).
