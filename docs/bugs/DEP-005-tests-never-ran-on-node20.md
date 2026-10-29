# DEP-005 — `npm test` never ran the API and reporting suites (380 tests)

| | |
|---|---|
| **Severity** | High (no safety net for any fix) |
| **Area** | Tooling / deploy |
| **Analysis ID** | — (found running the T1 baseline) |
| **Clue** | Original CLAUDE.md: "After every file change, run the full test suite" (the suite it names silently skipped most tests) |
| **Evidence** | S1 "Fix … with the smallest change that works" (needs working tests) |
| **Decision** | D-003 |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** `npm test` reported success for the small packages but never ran a single API or reporting test.
- **Why:** The test scripts pass a `src/**/*.test.ts` pattern to Node's test runner, and Node 20 (our image) doesn't expand patterns; Node 22 does.
- **What it breaks:** 365 API and 11 reporting tests, including the ones that show the refund and reporting bugs, were never run, so "tests pass" meant nothing.

## 1. The issue

```
$ docker compose -f ops/docker-compose.yml run --rm api npm test
> @filspay/api@0.1.0 test
> tsx --test --test-concurrency=1 "src/**/*.test.ts"
Could not find '/app/apps/api/src/**/*.test.ts'
npm error workspace @filspay/api@0.1.0 … command failed
```

Same for `@filspay/reporting`. Only `packages/money`, `packages/events` and `scripts` ran (59 tests).

## 2. Why it happened

`apps/api/package.json` and `apps/reporting/package.json`:

```json
"test": "tsx --test --test-concurrency=1 \"src/**/*.test.ts\""
```

The pattern is quoted, so the shell passes it through unchanged and Node's test runner must expand
it. Glob support in `node --test` arrived in Node 21; Node 20 treats the pattern as a literal path
and fails. `ops/Dockerfile.node` (written in DEP-001 from `ops/README.md`'s "`node:20`") used Node 20.
The repo itself targets newer Node: `@types/node` is `^24.5.2`.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| FilsPay engineers | Every "tests pass" was false for the API; regressions went unseen | High |
| Our team | No baseline: we couldn't show "red before, green after" for most bugs | High |
| Merchants, customers | Indirectly: bugs the tests already catch (refunds, reporting) were never noticed | Medium |

## 4. The fix

| File | Change |
|---|---|
| `ops/Dockerfile.node` | Both stages `FROM node:22-bookworm-slim` (Node 22 LTS) instead of 20. |
| `ops/README.md` | The Files table now says `node:22` LTS and why. |

All Node images (api, reporting, migrate, seed, web, admin) rebuilt. No test or app code changed.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Node 22 LTS in the image | Two lines; the scripts work as written; closer to the repo's `@types/node` 24 | Host `npm test` on Node 20 still fails (we run tests in Docker, SETUP §6) | ✅ |
| 2 | Rewrite the 3 test scripts to expand files with `find` | Works on any Node | Changes three `package.json` files; hides the version mismatch | |
| 3 | Node 24 | Matches `@types/node` exactly | Newer than needed; larger jump for native modules (argon2, sharp) | |

## 6. Proof

| Check | Before (Node 20) | After (Node 22) |
|---|---|---|
| `node --version` in the image | v20.20.2 | v22.23.4 |
| API suite | ❌ "Could not find 'src/**/*.test.ts'", 0 run | ✅ runs: 365 tests (353 pass, 12 fail = real bugs, see T1 baseline) |
| Reporting suite | ❌ 0 run | ✅ runs: 11 tests (7 pass, 4 fail = real bug) |
| money / events / web / scripts | 40 / 4 / 8 / 15 | unchanged |

The failures that now appear are existing bugs, recorded in `docs/challenge/TEST-BASELINE.md`
(T1) and added to the Master order.

Existing tests changed: none.
