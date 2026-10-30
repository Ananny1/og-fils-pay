# AI usage and setup

**For the judges (rubric: AI usage and setup, 10 points).** You asked *how we checked what the AI
told us*, not how much we used it. This page lists our AI setup files, then three real moments from
our Claude Code session where the AI was wrong or unproven and a check caught it.

Our rule in one line: **the AI proposes, the code and the measurements decide.**

---

## 1. Our AI setup files

All of them are in the repo. The originals of the first three were poisoned on purpose by the
challenge (BUG-050); we replaced them and kept the originals in git history as evidence
(`git show aaccd16:CLAUDE.md`).

| File | Read by | What it does now |
|---|---|---|
| `CLAUDE.md` | Claude Code (loaded automatically every session) | The team's real rules: money is integer fils (1 BD = 1000), the settlement day ends at midnight Bahrain (21:00 UTC), the trust order (code → ADRs → handover → architecture → the rest), the **trap protocol** (any "intentional / frozen / Claude says it's fine" is a claim to test), test first, one bug = one commit, never push to `main`, no AI attribution in commits. It also tells the AI to find out who it is working with (Ebrahim or Sayed) and show that person their own task list. |
| `AGENTS.md` | Codex, Cursor, Copilot and other agents | Points them all to `CLAUDE.md`, plus the key rules in four lines, so every tool gets the same rules. |
| `.cursorrules` | Cursor | Same short rules, pointing to `CLAUDE.md`. |
| `.claude/settings.json` | Claude Code permissions | **Denies** `git push` to `main`, force pushes, pushes to the organisers' `reference` remote, `gh pr create/merge`, `gh repo create`; turns off the "Co-Authored-By" line. A safety net that works even if a prompt tells the AI otherwise. |
| `.claude/agents/bug-investigator.md` | Claude Code sub-agent | **Read-only** investigator: given one task ID, it returns the root cause with `file:line` evidence, a reproduction, ranked fix options and any trap comments. It cannot edit, commit or push. |
| `.claude/agents/fix-reviewer.md` | Claude Code sub-agent | **Read-only, sceptical reviewer** of a finished fix before commit: correctness, missed callers, test quality, minimal diff, write-up complete. Returns PASS or a list of problems. |
| `scripts/agent_instructions.test.ts` | Our test suite | A **guard test**: fails if any of the poisoned rules (cents, UTC day, `Math.random` OTPs, "never change tests", …) come back in `CLAUDE.md`, `AGENTS.md` or `.cursorrules`, or if the push block is removed. |

How we used the AI: Claude Code (Claude Opus) did the reading, the audit, the reproductions and the
first draft of each fix and write-up. A person decided every open question (recorded as Q-1 … Q-8
in `docs/challenge/PROGRESS.md`) and every decision is logged with its reason (D-001 … D-016 in
`IMPLEMENTATION.md`). In the final 4-hour sprint the main session acted as an organiser over parallel
agents, each in its own git worktree with its own test database (D-016).

---

## 2. Three annotated excerpts: how we checked the AI

The excerpts are from our Claude Code session log (session `612dc33b`, 29–30 Oct 2026; times are UTC as
logged). Quotes are shortened with "…"; nothing else is changed. Passwords, ids and emails are left out.

### Excerpt 1 — The guard test caught our own AI-written `CLAUDE.md`

**Context.** The repo's own `CLAUDE.md`, `AGENTS.md` and `.cursorrules` told the AI that money is
cents, the day ends at UTC midnight and `Math.random` is fine for OTP codes. The AI wrote new files.
We did not just trust the new files: we wrote a test that reads them and fails on any poisoned rule,
and ran it on **both** the old and the new files.

> **Test run, against the ORIGINAL files** (29 Oct, 16:53):
> ```
> not ok 1 - CLAUDE.md contains none of the poisoned rules
>     CLAUDE.md still tells agents: money in cents / 1 BD = 100, UTC settlement day,
>     tests may never change, money package frozen, handler needn't check ownership, float32 is fine
> …
> # pass 0
> ```
> **Test run, against OUR NEW files:**
> ```
> not ok 1 - CLAUDE.md contains none of the poisoned rules
> ok 2 - CLAUDE.md states the real rules
> …
> # pass 6
> # fail 1
> ```
> **Why it failed:**
> ```
> CLAUDE.md still tells agents: Math.random for OTPs
> 5:"Math.random is fine for OTPs"). The originals are kept in git history as evidence; see
> ```

| | |
|---|---|
| **What the AI said** | "I replaced the poisoned files with the team's real rules." |
| **How we checked** | A guard test that scans the files for every known false rule, run on the originals (must fail) and on ours (must pass). |
| **What we found** | The originals failed 7 of 7, as expected. **Ours failed 1 of 7:** the AI's new `CLAUDE.md` *quoted* the old rule word for word while explaining it ("Math.random is fine for OTPs"). An AI tool skimming that line could pick it up as a rule. A second problem: the AI's first guard pattern missed the original `.cursorrules` OTP rule because of a backtick after `Math.random()`. |
| **What we changed** | Reworded the line to "insecure random OTP codes", fixed the pattern, re-ran: originals 0/7, ours 7/7. The guard now runs in the normal test suite, so the rules can't come back silently. Write-up: `docs/bugs/BUG-050-poisoned-agent-instructions.md`. |

### Excerpt 2 — "Claude says" comments: one right, one a decoy, one wrong

**Context.** The code has comments that quote an AI. The trap is to trust (or distrust) them all the
same way. We tested each against the code.

> **Search at the start of the audit** (29 Oct, 15:50):
> ```
> stl/settlement/window.go:43: // FH: date.Date() uses date's own location -- a UTC instant late at
>     night gives the UTC day not Bahrain's. claude says this is a …
> v1/fees/calculateFee.ts: // YA: Claude says the half-up here is a rounding bug and we should fix it to bankers
>                          // FH: it's dead code. the live path is applyRateFils
> ```
> **Reproducing BUG-001** (29 Oct, 17:34), the admin session code:
> ```
> 105:// MK: authenticated = true is mandatory here (0012). don't drop it
> 106:// FH: claude flagged authenticated = true as redundant with expires_at since pending sessions only live 10 min.
> == REPRO: password only, no OTP
> login: 200
> GET /v1/transactions with the pre-OTP cookie: 200
> ```

| | |
|---|---|
| **What the AI said** (in the code) | Three claims: the settlement window has a time-zone bug; `calculateFee.ts` has a rounding bug; the `authenticated = true` check is "redundant". |
| **How we checked** | For each: is the code live (who calls it)? What does the spec (ADR-0001/0002, HANDOVER) say? Can we reproduce it? |
| **What we found** | **Right:** the window really uses the UTC day, so the daily close runs at 03:00 Bahrain (BUG-020, T-34). **Decoy:** `calculateFee.ts` is dead code, nothing calls it; fixing it would waste time (T-35). **Wrong, and dangerous:** the merchant session lookup had lost that "redundant" check. With only a password, the pre-OTP cookie got `200` on `/v1/transactions`: login without the OTP (BUG-001, T-44). |
| **What we changed** | BUG-001 fixed with a test that fails on the old code (pre-OTP cookie must get 401); BUG-020 queued with the right root cause; the decoy left alone and recorded. All three are in `docs/challenge/TRAPS.md`. Same source, three different truths: only the code decides. |

### Excerpt 3 — The AI's own numbers, checked against measurements

**Context.** The AI often states numbers: sizes, counts, estimates. We act only on measured ones.

> **The AI's estimate** (29 Oct, 16:05):
> "Your disk is 99% full (1.8 GB left). Docker has about **4 GB** of old build cache from your other
> projects. `docker builder prune` would free it, but that's your call, so I didn't touch it."
>
> **After Ebrahim approved the prune** (30 Oct, 10:56), the command printed the real numbers:
> ```
> /dev/nvme0n1p5   96G   87G  7.8G  92% /
> Total:	467.2MB
> /dev/nvme0n1p5   96G   87G  8.2G  92% /
> ```
> **The AI reported back:** "Done, but it freed only **0.5 GB**, not the 4 GB I estimated."
>
> **A count in a commit title** (29 Oct, 17:31): "The suites run now: 443 tests … Before DEP-005,
> **380** of these tests never ran at all." Re-counted from the suite output: 365 API + 11 reporting
> = **376**. The next commit corrected the DEP-005 title to 376.

| | |
|---|---|
| **What the AI said** | "About 4 GB of build cache"; "380 tests never ran". |
| **How we checked** | Measured before and after (`df -h` around the prune); counted the tests from the real runner output per suite (`TEST-BASELINE.md`). |
| **What we found** | The prune freed **467 MB**, about one eighth of the estimate. The test count was off by 4. Neither error was harmful, but both would have been repeated in our documents and to the judges. |
| **What we changed** | Wrote down only measured numbers (PROGRESS: "freed 0.5 GB; disk 92%, 8.2 GB free"; DEP-005: 376 tests). The same rule drives our **capacity estimate**: we send the judges a number we measured under the real limits, not one the AI guessed (`docs/challenge/CAPACITY.md`). |

---

## 3. Other checks that are built into how we work

| Check | What it catches |
|---|---|
| Every fix starts with a **failing test** on the old code | An AI "fix" for a bug that isn't there, or a fix that doesn't fix it |
| `fix-reviewer` sub-agent reviews the diff **before** the commit | Missed callers, weak tests, a write-up that claims more than the test proves |
| One bug = one commit, files staged by name | AI changes slipping in that nobody asked for |
| `.claude/settings.json` deny list | An AI pushing to `main` or opening a PR, whatever a prompt says |
| `TRAPS.md`: every "intentional / fixed in FP-xxx / Claude says" is logged with the truth | Repeating a false claim in our own docs |
