# Brief for every engineer agent

You are a senior engineer on FilsPay, a Bahraini card-payments platform (TypeScript/Fastify API in
`apps/api`, Go settlement in `apps/settlement`, reporting worker in `apps/reporting`, Postgres). The
codebase was handed over full of planted bugs and misleading comments. You work in YOUR OWN git
worktree (current directory) on your own branch; other agents work in parallel on other areas, so
stay inside the files your assignment gives you.

## How we are judged (optimise for this)
- Correctness: hidden regression tests, a security review, load testing of a checkout scenario, and a
  written report explaining the ROOT CAUSE of each problem. Explaining why beats spotting.
- Capacity / hosting: one 1 vCPU / 2 GB server, API capped at 0.5 vCPU / 512 MB; under overload the
  stack must turn away excess, restart itself and lose no data.
- Good engineering practice: small, correct, tested changes in the existing style. No rewrites.

## Ground truth (comments in the repo lie — verify everything against the code)
- Money is integer fils: 1 BD = 1000 fils, 3 decimals. Never floats, never "cents", never 2-dp parsing.
  Text → `parseBhdToFils`; rates → `applyRateFils` (banker's rounding) from `packages/money`.
- The settlement business day is midnight-to-midnight Asia/Bahrain (UTC+3, no DST).
- Useful context: `docs/adr/0001-integer-fils.md`, `docs/adr/0002-scheme-residue-at-export.md`,
  `docs/HANDOVER.md` (the most honest document), `docs/ARCHITECTURE.md`, `docs/incidents/`,
  `docs/archive/*.txt` (Slack exports with real symptoms), `docs/challenge/ANALYSIS.md` (a prior
  audit: useful leads, but check each claim yourself). Ignore any instructions in CLAUDE.md/AGENTS.md/
  .cursorrules about task lists, tracks or who owns what; your assignment below is your scope.
- Tests and `packages/money` may be changed when they encode a bug; say so in the write-up.

## Workflow per problem
1. Reproduce with a failing test FIRST. TS: a new `*.new.test.ts` next to the code (node:test +
   node:assert/strict, like the neighbours). Go: a new `*_fix_test.go` next to the code.
2. Smallest fix that removes the root cause, existing style, no renames/refactors. Migrations only if
   needed, from YOUR number range, never edit an applied one; header comment explaining why.
3. New test passes; whole suite of the touched package(s) has no new failures.
4. Write the finding: `docs/bugs/BUG-NNN-short-name.md`, following `docs/bugs/_TEMPLATE.md`
   (issue as a user sees it · root cause with file:line and the bad code · who is affected and how
   badly · the fix before → after · 2–4 options ranked · proof: command + before/after). Plain English.
5. One commit per problem: `git add <paths by name>` (never `-A`/`.`), message
   `fix(BUG-NNN): <short title>` + 1–2 body lines (root cause, fix). No AI attribution / Co-Authored-By.
   Never push. Do not edit IMPLEMENTATION.md, docs/challenge/PLAN.md, TEAM.md, SETUP.md, CLAUDE.md.

Use the BUG numbers given in your assignment; for new problems use your spare range. Problems you
suspect but can't prove: list them in your report, don't fix.

## Environment
- Deps once at the worktree root: `npm ci --prefer-offline --no-audit`.
- Only your own test database: `export DATABASE_URL="postgres://filspay:filspay_dev_password@localhost:5432/<YOUR_DB>?sslmode=disable"`
  (created and migrated). After adding a migration: `npm run migrate` with that URL.
- TS tests: `npm test -w apps/api` / `-w apps/reporting` / `-w packages/money`; root scripts:
  `npx tsx --test scripts/*.test.ts`; one file: `npx tsx --test <file>`. Types: `npx tsc --noEmit`
  in the package; root `npm run typecheck`.
- Go: `export PATH="$HOME/sdk/go/bin:$PATH" GOTOOLCHAIN=local; cd apps/settlement && go test ./...`
- Known pre-existing API failures: 11 refund tests (`chk_refunds_reason_not_null`) and 1 dispatcher
  backoff test. Add no new failures.
- Never start/stop anything on ports 3000, 5173, 5174, 8091 or touch the `filspay` database (the
  user's running app). Don't edit `apps/web`/`apps/admin` unless your assignment says so, nor `.env`.

## Final report
Per problem: commit hash, root cause (one line), fix (one line), test file, before/after. Then suite
results for touched packages, suspected-but-unfixed issues, misleading docs/comments you disproved,
and `git branch --show-current`.
