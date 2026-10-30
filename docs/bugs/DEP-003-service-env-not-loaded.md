# DEP-003 — Compose never passes the service settings to the containers

| | |
|---|---|
| **Severity** | Blocker (plus a security risk on the hosted box) |
| **Area** | Deploy / config |
| **Analysis ID** | D2 (+ A5, part of D5) |
| **Clue** | compose header: "`.env.docker` … compose picks up automatically"; FH: "it exits at boot without the token for me. set it." |
| **Decision** | D-003 |
| **Status** | ✅ fixed |

## 1. The issue

The settings in `ops/.env.docker` (`NODE_ENV`, `SETTLEMENT_INTERNAL_TOKEN`, signing secrets) never
reach the services. Settlement has no internal token, and the API can't authenticate to it. On the
hosted box the API ran in **development mode**: the OTP code is returned in the login response
(A5) and cookies aren't `Secure`. Postgres was also published on `0.0.0.0:5432` with the default
password.

## 2. Why it happened

Docker Compose reads a `.env` file only to fill `${...}` placeholders **in the YAML**. A container
gets a file's variables only through `env_file:`. No service had `env_file:`, so the comment
"compose picks up automatically" was false. With `NODE_ENV` unset, `apps/api/src/config.ts`
defaults to `development`, and `otpDevExpose` defaults to `nodeEnv !== "production"`.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | On the hosted box the OTP comes back in the login response: the second factor is useless | High |
| FilsPay ops | Settlement internal API has no shared token; services misconfigured | Blocker |
| FilsPay (data) | Postgres reachable from the network with a known password | High |

## 4. The fix

| File | Change |
|---|---|
| `ops/docker-compose.yml` | `env_file: [{path: .env.docker, required: false}]` on migrate, seed, api, settlement, reporting. Postgres published on `127.0.0.1:${FILSPAY_PG_PORT:-5433}` (localhost only; 5433 avoids a host Postgres). Header comment corrected. |
| `ops/.env.docker.example` | New template with every required setting and how to generate the webhook key; says to use `NODE_ENV=production`, `OTP_DEV_EXPOSE=false` when hosted. |
| `.gitignore` | Allow `ops/.env.docker.example`; the real `ops/.env.docker` stays ignored. |

Minimal: no app code changed; the config loaders already read these variables.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | `env_file:` per service + committed example, secrets git-ignored | Standard compose; secrets stay out of git | One more file to copy on setup | ✅ |
| 2 | Put the values directly in `environment:` | One file | Secrets committed to git (the reference repo already leaked one, D4) | |
| 3 | Change `config.ts` defaults (e.g. production by default) | Safe default | App code change; breaks local dev and tests; doesn't fix the token | |

## 6. Proof

| Check | Before | After |
|---|---|---|
| Settlement daemon boot | ❌ exits without `SETTLEMENT_INTERNAL_TOKEN` | ✅ `internal api: listening on :8091` |
| `curl localhost:3000/readyz` | — | ✅ `{"status":"ready"}` |
| `GET /v1/transactions` with a seeded API key | — | ✅ returns data |
| Postgres port | `0.0.0.0:5432` | `127.0.0.1:5433` |

Existing tests changed: none.

**Still open (Phase 6):** a production-mode run (`NODE_ENV=production`, `OTP_DEV_EXPOSE=false`);
making `otpDevExpose` default to false in code (A5); per-service DB roles + TLS (D5).
