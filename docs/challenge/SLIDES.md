# Technical defence — slide outline

**Rubric: Technical defence, 20 points.** The judges ask questions and **choose who answers**, so
Ebrahim and Sayed must both be able to explain every slide and every fix. Anything we can't explain
or show working doesn't score.

12 slides, about 12 minutes, then questions. Each slide: title, what's on it, what we say, who leads
(the other one must be able to say it too). `[[…]]` = a number to fill in before the presentation.

Sources: `docs/FINDINGS-REPORT.md` (every root cause), `docs/challenge/PRESENTATION.md` (flag and
traps), `docs/challenge/AI-USAGE.md` (AI excerpts), `docs/challenge/CAPACITY.md` (capacity numbers),
`docs/bugs/` (proof per fix).

---

## Slide 1 — Title

- **FilsPay: we didn't just listen, we checked.**
- Team: Ebrahim, Sayed. Live URL: `[[Dilmune Cloud URL]]`.
- One line: a Bahraini payment platform with ~55 bugs, poisoned AI instructions and a missing refunds feature.

**Lead:** Ebrahim.

## Slide 2 — The problem we were handed

- The app didn't even build: missing Dockerfiles, migrations that fail on a fresh DB, settings never loaded (DEP-001–005).
- Security holes: login without the OTP, one shop acting in another shop's account.
- Wrong money: amounts 10× off, payments charged twice, a closing day at 03:00 instead of midnight.
- A missing feature: refunds (FP-300) return 501.
- A trap: the repo's own AI instruction files told the AI to keep the bugs.

**Say:** "Money is integer fils, 1 BD = 1000 fils. The day closes at midnight Bahrain, 21:00 UTC.
Half the repo tried to make us forget those two rules." **Lead:** Sayed.

## Slide 3 — How we worked

| Step | What |
|---|---|
| Trust order | Code → ADR-0001/0002 → HANDOVER → ARCHITECTURE → everything else |
| Trap protocol | "intentional", "frozen", "already fixed", "Claude says it's fine" = a claim to test |
| Test first | Red test on the old code → smallest fix → green |
| One bug = one commit | Fix + test + write-up together; revertable alone |
| Write-up | What's wrong / why / who is hit / fix / 3+ options ranked / proof |

**Lead:** Ebrahim. **Sayed must know:** why we changed tests that check *for* a bug (CSV test expecting 4.75 BD → 475 fils).

## Slide 4 — What we found (numbers)

- Table from `FINDINGS-REPORT.md` §1: 55 findings in 8 areas, 24 critical.
- Fixed: `[[N fixed]]` with tests · open but root cause documented: `[[N open]]`.
- The five patterns: check-then-act with no lock · wrong unit/number type · UTC instead of Bahrain · missing scope in a query · a false comment stopped the fix.

**Lead:** Sayed.

## Slide 5 — Top fix 1: login without the OTP (BUG-001) + session fixation (BUG-032)

| | Before | After |
|---|---|---|
| Password only, then `GET /v1/transactions` with the pre-OTP cookie | **200** (full access) | **401** |
| Copied pre-OTP cookie after the real user finishes the OTP | 200 | 401 (token rotated) |

**Root cause:** `lookupSession` read a view that filtered revoked/expired sessions but not
`authenticated = true`. A comment said Claude called that check "redundant" (T-44).
**Demo:** curl the login, show 401. **Lead:** Sayed.

## Slide 6 — Top fix 2: staff "view as shop" had owner powers (BUG-010) + OTP brute force (BUG-011)

| | Before | After |
|---|---|---|
| Super-admin viewing a shop creates a payment link | **201** (recorded as the shop) | **403** |
| 40 parallel OTP guesses, limit 5 | **12** checked | **5** |
| OTP generator | `Math.random` | `crypto.randomInt` |

**Root cause:** role map `super_admin → owner`; no write block on impersonation. OTP counter read,
checked, then increased with no lock. **Lead:** Ebrahim.

## Slide 7 — Top fixes 3: money (sprint fixes)

One row per money fix landed in the sprint; fill from the merged commits.

| Bug | Before | After | Test |
|---|---|---|---|
| BUG-014 CSV import | "4.75" → 475 fils | "4.75" → 4750 fils | `[[test file]]` |
| BUG-005 link charged twice | `[[2 charges]]` | `[[1 charge]]` | `[[…]]` |
| BUG-020 daily close | 03:00 Bahrain | 00:00 Bahrain | `[[…]]` |
| BUG-016 split payouts | children sum < net | children sum = net, to the fil | `[[…]]` |
| BUG-009 holds cleanup | quiet night: **all** holds deleted | 0 deleted, overdue ones flipped to `expired` | `scripts/expire_holds.integration.test.ts` |

**Lead:** Ebrahim (money is his track). **Sayed must know:** fils vs cents, and why `float32` breaks above ~16,777 BD.

## Slide 8 — The missing feature: refunds (FP-300)

- Route `[[path]]` with owner/finance role, **required `Idempotency-Key`** (the drafted handler made its own key, which stops nothing).
- One DB transaction, row lock (`FOR UPDATE`), scoped to the caller's shop → fixes two parallel refunds (BUG-034), refund of another shop's payment (BUG-036).
- Refundable = **captured** − refunded (BUG-035), not authorized − refunded.
- Fee reversal never more than the original fee in total (BUG-056).
- `refund.succeeded` webhook; ledger balanced to the fil.
- Not done (say so honestly): `[[e.g. next batch reduced by refunds (FP-300.3), reports (FP-300.5)]]`.

**Demo:** refund half, refund the rest, try once more → refused. **Lead:** Sayed.

## Slide 9 — Hosting and capacity

| | Value |
|---|---|
| Server | 1 vCPU, 2 GB RAM, one box (`[[Dilmune Cloud]]`) |
| API limit | 0.5 vCPU, 512 MB (compose `deploy.resources`) |
| Build | compiled API (no `tsx` at runtime), static web/admin (no Vite dev servers) |
| Restarts | `restart: unless-stopped` + health checks |
| Checkout scenario, measured | `[[N]]` users/s at p95 `[[ms]]`, 0 errors (from `CAPACITY.md`) |
| Our estimate sent to the judges | `[[N]]` concurrent users |
| Over the limit | excess gets **429/503 + `Retry-After`** fast, instead of timing out |
| Kill drill | API / Postgres killed mid-checkout → restarted in `[[s]]`, **0 lost or doubled payments** |

**Lead:** Ebrahim. **Sayed must know:** how the number was measured and why we turn work away.

## Slide 10 — The traps and the hidden flag

- **`FLAG{order_of_the_prompt_never_read_the_diff}`**, found in the reference repo's git history: Base64 → Vigenère (key `diffs`) → ROT13 → AES-256 (password `2026-09-28`).
- Its hint: "Fix what he started: `ya/sign-raw`, the abandoned migrations, the handover warnings" → BUG-023, DEP-002, BUG-009/010/032.
- Headline traps (from `PRESENTATION.md`): T-01 cents · T-03 UTC day · T-06 never change tests · T-09 super_admin → owner "approved" · T-44 "authenticated is redundant" · T-35 decoy in dead code.
- 40+ false claims logged in `TRAPS.md`.

**Lead:** Sayed.

## Slide 11 — How we used AI, and how we checked it

Three excerpts from `AI-USAGE.md`, one line each:

1. Our guard test caught **our own** AI-written `CLAUDE.md` quoting a poisoned rule → reworded, guard now in the suite.
2. Three "Claude says" comments: one right (03:00 close), one decoy (dead code), one wrong ("redundant" check → login without OTP).
3. AI estimates vs measurements: "4 GB cache" → 0.47 GB freed; "380 tests" → 376.

Setup: `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.claude/settings.json` (push to `main` denied),
read-only `bug-investigator` and `fix-reviewer` agents. **Lead:** Ebrahim.

## Slide 12 — What we'd do next

- Finish the open bugs in priority order (`FINDINGS-REPORT.md`, ⬜ rows): `[[top 3 left]]`.
- Refunds reduce the next payout (FP-300.3) and show in reconciliation (FP-300.5).
- Enhancements kept out of the bug fixes: email OTP delivery (ENH-001), authenticator-app OTP (ENH-002), email verification at signup (ENH-008), per-service DB roles + TLS (ENH-006), CORS allowlist (ENH-003).
- Rotate the acquirer secret leaked in the reference history; close the DB port.

**Lead:** Sayed.

---

## Live demo script (3 minutes, backup: screenshots in `docs/challenge/evidence/`)

1. Shop login: the reply no longer contains the OTP code (show the JSON) — BUG-031. `[[If ENH-001 is in: read the code from the Mailpit inbox]]`.
2. Pre-OTP cookie → 401 — BUG-001.
3. Admin "view as shop" → read-only banner, write → 403 — BUG-010.
4. Pay a payment link → success; pay again → refused — BUG-005 / BUG-004.
5. Refund part, then the rest, then once more → refused — FP-300.
6. If live: show the capacity run output and a container restart.

---

## Likely judge questions and short answers

Both of us should be able to say every answer below.

| # | Question | Short answer |
|---|---|---|
| 1 | Why integer fils and not decimals? | 1 BD = 1000 fils. Floats can't hold 0.001 exactly and drift; integers can't. ADR-0001. Text is parsed with `parseBhdToFils`, rates with `applyRateFils` (half-to-even). |
| 2 | When does the settlement day end? | Midnight Bahrain = 21:00 UTC (no DST). The bug used the UTC calendar day, so the close ran at 03:00 Bahrain. |
| 3 | How did you know which docs to trust? | Trust order: code first, then ADR-0001/0002, then Yousif's HANDOVER, then ARCHITECTURE. Anything else had to be proven with a test. |
| 4 | You changed existing tests. Isn't that cheating? | Only tests that asserted the bug, e.g. the CSV test expecting 4.75 BD → 475 fils. Each change is justified in the write-up. The poisoned `CLAUDE.md` said "never change tests" exactly to stop that. |
| 5 | How do you stop a payment link being charged twice? | `[[S2's chosen fix, e.g. hold the row lock for the whole pay flow / unique guard on the link's capture]]`; the second payer gets a clear error, never a second charge. |
| 6 | How do you stop two refunds at once? | One DB transaction, `SELECT … FOR UPDATE` on the transaction row scoped to the shop, re-check refundable inside the lock, plus a required `Idempotency-Key`. |
| 7 | Why is "view as shop" read-only? | HANDOVER: every grant is `support`. Before, a super-admin got owner powers and their actions were recorded as the shop's own. Now any non-GET on an impersonation grant gets 403. |
| 8 | Why rotate the session token after the OTP? | Session fixation: anyone who saw the pre-OTP cookie would be logged in once the real user finished the OTP. A new token at verify kills the old one. |
| 9 | What's your capacity number and how did you measure it? | `[[N]]` users on the checkout scenario at p95 `[[ms]]`, measured with `[[k6/autocannon]]` under the same limits (API 0.5 vCPU / 512 MB). See `CAPACITY.md`. |
| 10 | What happens when we push past that? | Excess gets 429/503 with `Retry-After` quickly; containers restart on crash; payments are in Postgres transactions with idempotency keys, so nothing is lost or doubled. |
| 11 | What did the AI get wrong? | Three examples in `AI-USAGE.md`: it quoted a poisoned rule in our own `CLAUDE.md` (our guard test caught it), it over-estimated the disk cache 8×, it miscounted the tests. Plus the "Claude says" comments in the code, one of which caused login without OTP. |
| 12 | What's the hidden flag and what does it mean? | `FLAG{order_of_the_prompt_never_read_the_diff}`. It mocks the poisoned AI rules. The lesson is the opposite: always read the diff. |
| 13 | What didn't you fix, and why? | `[[list from FINDINGS-REPORT ⬜ rows]]`. We fixed by points: security and double money first. Each open one has its root cause documented. |
| 14 | Why not a bigger refactor? | Smallest change that removes the root cause, in the existing style, so each fix is easy to review and revert. Bigger ideas became ENH items. |
| 15 | What is BUG-037 and why isn't it fixed? | Signup accepts an existing email. Dangerous only with BUG-002 (OTP bound by email), which we fixed. Shared emails across shops are legitimate, so it became an enhancement (email verification, ENH-008). |
