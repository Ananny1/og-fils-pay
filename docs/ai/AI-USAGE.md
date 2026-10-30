# How we used AI, and how we checked it

The judges score how we checked what the AI told us, not how much we used it. This file lists our
AI setup and three annotated excerpts from real sessions where the AI's claim, or the repo's
AI-written claims, turned out wrong and were caught by checking.

## Our AI setup (in this repository)

| File | What it does |
|---|---|
| `CLAUDE.md` | Rules for coding agents: integer fils, Bahrain business day, trust order (code → ADR-0001/0002 → HANDOVER → ARCHITECTURE → everything else), trap protocol, one bug = one commit, never push. Replaces the original poisoned file (kept in git history). |
| `AGENTS.md`, `.cursorrules` | Same rules for other tools. The originals told agents money was "cents", settlement ran on UTC midnight, `Math.random` was fine for OTPs and tests must never change. All four claims were false (`docs/challenge/TRAPS.md`). |
| `.claude/settings.json` | Denies `git push` / `gh pr create` to agents and turns off AI co-author lines. A human pushes after reading the diff. |
| `docs/ai/agent-brief.md` | The brief every parallel fix agent received: ground truths, "comments lie, verify", failing test first, one commit per problem, own test database per agent. |
| `docs/challenge/GUIDE.md`, `TRAPS.md` | Trust order and every false claim we found, so no agent repeats it. |
| `docs/evidence/tools/*.mjs` | Headless-browser scripts that log into both apps and screenshot them, so UI claims are checked with pictures, not descriptions. |

How we worked: the AI proposes; a test, a request, a database query or a screenshot decides. Every
fix starts with a test that fails for the stated reason. Agents run in separate git worktrees with
separate databases; a human merges and pushes.

---

## Excerpt 1 — A comment said CORS existed. One request proved it didn't.

**Context.** The merchant dashboard (port 5173) could not log in. The browser showed the login
request with "provisional headers" and no response. The API looked healthy.

**What the code claimed** (`apps/web/src/api/client.ts`):

```ts
// FH: credentials include needs allow-credentials CORS on the api. works locally
// MK: CORS is locked to the two origins in config. fine
```

**What we ran instead of trusting it:**

```
$ curl -i -X OPTIONS http://localhost:3000/v1/auth/login \
    -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: POST'
HTTP/1.1 404 Not Found
{"message":"Route OPTIONS:/v1/auth/login not found", ...}

$ grep -rn "cors\|Access-Control" apps/api/src   → nothing
```

The same login with `curl -X POST` returned 200, which is why nobody noticed: curl never sends the
browser's preflight.

**Annotation.** The comment was confident and wrong; there was no CORS code and no "config". We wrote
a failing test first (`apps/api/src/plugins/cors.new.test.ts`: preflight from 5173 must be 204 with
`Allow-Credentials`, an unknown origin must get nothing), then a small plugin. The test, not the
comment, is now the source of truth. Later we also confirmed with a live preflight that the running
API had been restarted with the fix (it hadn't been, the first time — the old process was still on
port 3000).

---

## Excerpt 2 — "The assistant is unavailable." Two different root causes, both found by reproducing.

**Context.** We added a Claude-backed assistant to the dashboard. After the user pasted the API key
it still answered "The assistant is unavailable right now."

**Step 1 — don't guess, reproduce outside the app.** A direct SDK call with the same key:

```
ERR AnthropicError undefined Cannot convert argument to a ByteString because the
character at index 113 has a value of 8232 which is greater than 255.
```

Character 8232 is U+2028 (an invisible "line separator") that came along when the key was copied
from a chat window. HTTP headers can't carry it. Fix: strip it from `.env` (without printing the
key) and make `config.ts` strip non-printable characters from the key so it can't recur. The direct
call then returned `CLAUDE OK: end_turn Ok`.

**Step 2 — the error came back. Read the real log, not the friendly message:**

```
"err":{"type":"BadRequestError","message":"400 ... tools.0.custom: For 'integer' type,
properties maximum, minimum are not supported"}
```

The AI that wrote the tool definitions had used `minimum`/`maximum` on integers in strict tool
schemas, which the API rejects. Fix: drop them and enforce the limits on the server (the tool code
already clamped them; we added a date check to replace the removed regex).

**Step 3 — check the answer, not just that there is one.** First real answer: "On 2026-08-30 you
captured 426.987 + 496.948 + 57.006 = **980.941 BHD**." We added it by hand (980.941 ✓) and then,
when asked "is the data accurate?", compared every figure in a longer answer with the database:

| Claude said | Database |
|---|---|
| Nothing captured 22–29 Oct | 0 rows |
| Newest payment 30 Aug | `alpha-retail-txn-0009`, 30 Aug |
| 31 Aug batch: 7326.913 / 183.174 / 7143.739, not paid | 7,326,913 / 183,174 / 7,143,739 fils, `paid_at` NULL |

**Annotation.** A generic error hid two unrelated causes; each was found by reproducing at a lower
level and reading the exact error. We also verified the content of the AI's answer against the
source data — and designed the feature so the model never does money arithmetic: the server
pre-formats every amount from integer fils and the model only copies them.

---

## Excerpt 3 — Checking the AI's own earlier work.

**3a. A merge where our own earlier fix was the wrong one.** Early on, the AI fixed "a fresh
database can't be migrated" by moving migrations 0054–0056 into an ignored folder. A teammate fixed
the same problem differently (neutralising only the broken view inside 0054). When merging, instead
of keeping "ours", we read what 0054 actually creates:

```sql
CREATE OR REPLACE VIEW merchant_payable_position AS ...   -- still in 0054
```

```
$ grep -rn merchant_payable_position apps/settlement
internal/ledger/refresh.go: ... FROM merchant_payable_position
```

The Go balance-rebuild path reads that view. The AI's own fix would have deleted it and broken the
admin "Rebuild cached balances" action on any fresh install. We took the teammate's version and
said so in the merge commit.

**3b. A number on the landing page.** The AI-generated "tonight's batch" demo card showed
`FEE 2.25% = 3.937 BD` on `175.134 BD`. Recomputed with the same helper the fee engine uses:

```
$ npx tsx -e 'applyRateFils(toFils(175134), 225)'   →  3941
```

3.937 was wrong (3.941 is right, net 171.193). A payments product can't show a wrong fee even in a
demo; the card now computes the fee with `applyRateFils` instead of a hard-coded number.

**Annotation.** "The AI wrote it" is not evidence. We applied the same checks to the AI's earlier
output as to the inherited code: read what the change actually removes, grep for who depends on it,
and recompute numbers with the production code path.

---

## Rules we followed with AI throughout

1. A claim in a comment, a doc, a ticket or an AI answer is a hypothesis. A test, a request, a query
   or a screenshot settles it.
2. Every fix starts with a failing test that fails for the stated reason.
3. Money is checked with the production helpers (`parseBhdToFils`, `applyRateFils`, `formatBhd`),
   never by mental arithmetic or floats.
4. AI never pushes. A human reads the diff, runs the suite and pushes.
5. Parallel agents get their own worktree and database, a written brief, and are re-verified on
   merge: full test suite, type-check and build.
