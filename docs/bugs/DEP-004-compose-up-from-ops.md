# DEP-004 — `docker compose up` in `ops/` (the brief's own instruction) fails on a fresh clone

| | |
|---|---|
| **Severity** | High (the organisers' first step fails) |
| **Area** | Deploy |
| **Analysis ID** | D2 follow-up |
| **Clue** | S1 "Run `docker compose up` in `ops/` to start everything on your laptop"; FH in compose: settlement "exits at boot without the token for me" |
| **Evidence** | S1 |
| **Decision** | D-003 |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** On a fresh clone, `docker compose up` in `ops/` leaves settlement, the API and the seed crashed.
- **Why:** Every service started at the same time as the migrations, and without a hand-made settings file settlement had no internal token.
- **What it breaks:** Nobody (including the judges) can start FilsPay the way the brief says; the seed can even run before the tables exist.

## 1. The issue

Fresh clone, no `ops/.env.docker`, new database, `cd ops && docker compose -p fpfresh up -d`:

```
api        exited  Exited (1)    WEBHOOK_SECRET_ENCRYPTION_KEY must base64-decode to exactly 32 bytes, got 34   (BUG-058)
seed       exited  Exited (1)    same
settlement exited  Exited (1)    config: SETTLEMENT_INTERNAL_TOKEN environment variable is not set
migrate    exited  Exited (0)    66 migration(s) applied
```

and migrate, seed, api and settlement were all started within the same second.

## 2. Why it happened

- `ops/docker-compose.yml`: `seed`, `api`, `settlement` and `reporting` each had only
  `depends_on: postgres: condition: service_healthy`. Nothing waited for `migrate` to **finish**, so
  the seed (and the services' first queries) could hit a database without tables.
- After DEP-003, settings come from `ops/.env.docker`, which is git-ignored. A fresh clone has none,
  so `SETTLEMENT_INTERNAL_TOKEN` is unset and settlement's daemon refuses to start
  (`RequireInternalToken`). The compose comment "falls back to dev-token" was false (FH noticed).
- The API's own dev fallback key was invalid: fixed separately as BUG-058.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Judges / organisers | Their documented start command fails | High |
| New engineers | Must reverse-engineer three settings and the start order | High |
| Merchants, customers | Not directly | — |

## 4. The fix

| File | Change |
|---|---|
| `ops/docker-compose.yml` | `seed`, `api`, `settlement`, `reporting` now `depends_on: migrate: condition: service_completed_successfully` (start order: postgres → migrate → the rest → web/admin). Every service loads `env_file: [.env.dev, .env.docker (optional)]`; the second overrides the first. Header comment explains both. |
| `ops/.env.dev` | New, committed, **laptop only**: `NODE_ENV=development`, a dev-only settlement token, a valid dev webhook key, a dev acquirer secret. Header says it must be overridden on a hosted box. |
| `.gitignore` | Allow `ops/.env.dev` (the real `ops/.env.docker` stays ignored). |
| `docs/challenge/SETUP.md` | First-time setup is now the brief's one command; notes that `up` re-seeds. |

No application code changed.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | `service_completed_successfully` on migrate + committed laptop `.env.dev` loaded before the optional `.env.docker` | The brief's command works on a fresh clone; hosted settings still win; no code change | Dev-only values are in git (clearly labelled, never valid in production) | ✅ |
| 2 | `${VAR:-default}` defaults in each service's `environment:` | No extra file | `environment:` beats `env_file:`, so a hosted `.env.docker` would be silently ignored, which is the DEP-003 failure again | |
| 3 | A built-in dev token in the Go settlement code | No compose change | Weakens settlement's "token required" posture in code | |
| 4 | Keep requiring `.env.docker`, fail with a clear message | No dev values in git | The brief's one-command start still fails | |

Risk kept in view: a hosted box started **without** `ops/.env.docker` would run with dev values.
That is handled in Tier 8 (D5 / DEPLOY): the deploy checklist requires `.env.docker` with
`NODE_ENV=production`. Q-7 (should the seed run on the hosted box) is open.

## 6. Proof

| Check | Before | After |
|---|---|---|
| Fresh clone, no settings file, `cd ops && docker compose up -d` | ❌ api, seed, settlement exited (1) | ✅ 6 services Up; migrate and seed Exited (0) |
| Start order | all at 17:21:5x together | migrate 17:26:17 → finished 17:26:18 → seed started 17:26:19 |
| `curl localhost:3000/readyz` | connection refused | ✅ `{"status":"ready"}` |
| Settlement | "SETTLEMENT_INTERNAL_TOKEN … not set" | ✅ "internal api: listening on :8091" |
| Login through the dashboard proxy | — | ✅ OTP challenge returned |
| With `ops/.env.docker` present, its token overrides `.env.dev` | — | ✅ (sha256 of the resolved value equals the file's value) |

Existing tests changed: none.
