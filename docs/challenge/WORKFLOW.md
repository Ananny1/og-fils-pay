# Workflow — how every task is done

Every task (bug, feature step, frontend item, deploy step) goes through the same 8 steps. The
order of tasks is the **Master order** at the top of `PLAN.md`. The live checkpoint is
`PROGRESS.md`: if work is cut off at any point, the next session reads it and carries on.

```
0 Claim → 1 Understand → 2 Plan (ideas + perspectives) → 3 Test first → 4 Fix
        → 5 Verify (tests + real run + review) → 6 Document → 7 Commit + push → back to 0
```

---

## 0. Claim and checkpoint

- Take the **first ⬜ task in the Master order** (unless the user picks one). Check its "Needs" column:
  don't start a task whose dependency isn't ✅.
- Make sure you are on your own branch (`ebrahim/track-b` for Ebrahim) and up to date:
  `git pull --rebase origin main` when main has moved.
- Write the task into `PROGRESS.md` → "Now": ID, step `0-claimed`, branch, time.

## 1. Understand

- Read the task's entry in `ANALYSIS.md`, the clue (handout sheet, ticket, incident, doc), and the code.
- **Reproduce it for real** where possible: curl, the dashboards, SQL, or a script in a rolled-back
  transaction. Save the exact before-output; it goes into the write-up.
- Ask the trap questions (`GUIDE.md` §4): which comment, doc or test says this is "intentional"? Is that true?
- Optional: run the **`bug-investigator`** agent on the next task in the background while you work on this one.
- `PROGRESS.md`: step `1-understood`, plus one line on the root cause.

## 2. Plan — ideas and perspectives

Before writing code, write down (in `PROGRESS.md` → "Notes", later copied into the write-up §5):

| Perspective | Question |
|---|---|
| Security | What can an attacker do with this today? After the fix? |
| Money | Can a fil be lost, created or counted twice? Is it integer fils end to end? |
| Concurrency | Two requests at once, two replicas, a retry, a double click? |
| Time | Bahrain business day (UTC+3)? Expiry decided by the server? |
| Data / history | Is anything deleted that should be kept? Do old rows still make sense? |
| User / UX | What does the shop, customer or staff member see? Is the error clear? |
| Ops / deploy | Migration needed? Safe on an existing database? Config change? |
| Judges | Is this the **smallest** change that removes the **root cause**? |

Then list **at least 3 options**, including one "outside the box" idea (a different design, a
platform feature, something reused from another project), rank them, and pick one. Record why
the others lost. Ideas that are good but too big go to "Ideas for later" in `PROGRESS.md`.

`PROGRESS.md`: step `2-planned`, chosen option.

## 3. Test first

- Write the test that shows the bug **before** fixing it, and run it: it must fail (or show the bug).
- Put it next to the code, in that package's style (`node:test`, `*.test.ts`; Go `*_test.go`).
  Database tests run inside a transaction that is rolled back.
- A test that asserts the bug may be changed (D-004); say so in the write-up.
- `PROGRESS.md`: step `3-test-red`.

## 4. Fix

- The smallest change that removes the root cause, in the surrounding style (ANALYSIS §2).
- New migrations only in your range (Ebrahim 0080+ / 0073+ for Track A items, see `TEAM.md`).
- No refactors or renames the fix doesn't need.
- `PROGRESS.md`: step `4-fixed` and the list of changed files (so a cut-off doesn't lose them).

## 5. Verify

All of these, with output saved for the write-up:

1. The new test passes.
2. The package's whole test suite passes (no regressions), plus the type check.
3. A **real run**: the same reproduction from step 1, now showing the correct result.
4. Neighbours: grep for other callers or copies of the same pattern (e.g. the admin OTP mirrors
   the merchant OTP). Fix them in the same commit only if they're the same bug; otherwise add a task.
5. Optional for ★★★: run the **`fix-reviewer`** agent on the diff + write-up; fix what it finds.

`PROGRESS.md`: step `5-verified`.

## 6. Document

- Write-up `docs/bugs/<ID>-<short-name>.md` from `docs/bugs/_TEMPLATE.md`:
  **Summary** (what's wrong / why / what it breaks: the organisers' "short note"), then
  1 issue · 2 why · 3 who was affected · 4 fix · 5 options ranked · 6 proof.
- `IMPLEMENTATION.md`: bug register row ✅ + link, step-log row, new D-entry if a decision was made.
- `PLAN.md`: Master order status ✅ (the only status that counts).
- `TRAPS.md`: any false claim found.
- `PROGRESS.md`: step `6-documented`.

## 7. Commit and push

- One task = one commit. Stage files **by name**. Message:
  `fix(<ID>): <what the fix does>` + a body of 2–3 lines (root cause → fix → proof).
- Push to **your own branch**: `git push -u origin ebrahim/track-b`. Never push to `main`, never force-push.
- `PROGRESS.md`: move the task to "Done" with the commit hash, clear "Now".

---

## If work is cut off

`PROGRESS.md` always says which task and which step. To resume:

| Last step in PROGRESS | What to do |
|---|---|
| `0-claimed` … `2-planned` | Re-read the notes, carry on from that step |
| `3-test-red` / `4-fixed` | `git status` + `git diff` show the work; re-run the test and continue |
| `5-verified` | Only documentation is missing; write it |
| `6-documented` | Check `git status`, then commit and push |
| Uncommitted changes from an unknown task | Don't guess: `git stash` them, note it in PROGRESS, ask the user |

## Agents (in `.claude/agents/`)

| Agent | Use it for | Output |
|---|---|---|
| `bug-investigator` | Read-only deep dive on a task before planning it | Root cause with file:line, how to reproduce, 3+ ranked options (one creative), the tests to write, traps |
| `fix-reviewer` | Independent check of a finished fix before committing | PASS, or a list of concrete problems (correctness, missed callers, tests, write-up gaps) |

## Done means

A task is ✅ only when: the reproduction now shows the right result, tests pass, the write-up has
the summary + all 6 parts, `IMPLEMENTATION.md` / `PLAN.md` are updated, and the commit is pushed.
