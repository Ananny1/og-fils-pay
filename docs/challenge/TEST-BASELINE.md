# Test baseline (T1) — 2026-10-29

The state of every test suite **before** the Tier 1+ fixes, so each later fix can show "red before,
green after". Taken after DEP-005 (before it, the API and reporting suites didn't run at all).

**How it was run** (inside Docker, Node 22; the TS tests use the local database, re-seed afterwards):

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps api sh -c \
  'for w in packages/events packages/money apps/api apps/reporting apps/web; do (cd $w && npm test); done; npx tsx --test scripts/*.test.ts'
cd apps/settlement && DATABASE_URL=postgres://filspay:filspay_dev_password@127.0.0.1:5433/filspay?sslmode=disable go test ./...
docker compose -f ops/docker-compose.yml run --rm seed
```

## Results

| Suite | Tests | Pass | Fail | Notes |
|---|---|---|---|---|
| `packages/events` | 4 | 4 | 0 | |
| `packages/money` | 40 | 40 | 0 | |
| `apps/api` | 365 | 353 | 12 | never ran before DEP-005 |
| `apps/reporting` | 11 | 7 | 4 | never ran before DEP-005 |
| `apps/web` | 8 | 8 | 0 | |
| `scripts` | 15 | 14 → 15 | 1 → 0 | the 1 was our own guard test (fixed in `9d209d7`) |
| Go `apps/settlement` | 7 packages | all ok | 0 | the settlement bugs have no tests covering them yet |
| **Total TS** | **443** | **426** | **17** | |

## The failures and what they mean

| # | Failing tests | First error | Cause | Task |
|---|---|---|---|---|
| 1 | 11 refund tests in `apps/api` (`processRefund.test.ts` 149–157, `initiateMerchantRefund.test.ts` 176–181) | `new row for relation "refunds" violates check constraint "chk_refunds_reason_not_null"` | Migration 0070 added a CHECK that `reason` is not null; `processRefund` inserts `reason ?? null` (ANALYSIS R8) | **BUG-061** (Tier 6, first) |
| 2 | 4 reporting tests (`runRebuild`, `runConsumerPass` ×3) | `null value in column "merchant_id" of relation "merchant_daily_volume"` | The reporting consumer reads `merchant_id` from a place the producers' event payloads don't put it | **BUG-059** (Tier 5) |
| 3 | 1 webhook test (`apps/api` 332, backoff/exhaustion sequence) | `AssertionError … expected: 1000` | Retry backoff timing differs from the configured base | **BUG-060** (Tier 5, investigate) |
| 4 | 1 guard test (`scripts/agent_instructions.test.ts`) | `ENOENT … /app/.claude/settings.json` | `.dockerignore` kept `.claude/` out of the image | fixed (`9d209d7`) |

Every later fix re-runs the suite of the package it touches; the totals here are the reference.
