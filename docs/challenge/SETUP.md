# Setup — run FilsPay on your machine

Everything runs in Docker. You need: **Docker + Docker Compose v2**, **git**, about **4 GB free disk**.
Node 20 and Go 1.22 on the host are only needed to run tests outside Docker.

All commands run from the **repo root**. Short form used below:

```bash
alias dc='docker compose -f ops/docker-compose.yml'
```

---

## 1. First time

```bash
git clone https://github.com/Ananny1/fils-pay.git && cd fils-pay

# Settings file (git-ignored). Then fill in the 3 secrets:
cp ops/.env.docker.example ops/.env.docker
#   SETTLEMENT_INTERNAL_TOKEN=<any long random string>      e.g. openssl rand -hex 24
#   WEBHOOK_SECRET_ENCRYPTION_KEY=<openssl rand -base64 32>
#   ACQUIRER_CALLBACK_SIGNING_SECRET=<any long random string>

dc build                      # builds all images (first time: a few minutes)
dc up -d postgres             # database
dc run --rm migrate           # creates all tables → "66 migration(s) applied"
dc run --rm seed              # test data → "all REAL assertions passed" + one API key per shop
dc up -d                      # api, settlement, reporting, web, admin
```

Check it works:

```bash
dc ps                                   # 6 services "Up"
curl localhost:3000/readyz              # {"status":"ready"}
```

## 2. What runs where

| Service | Address | What it is |
|---|---|---|
| **web** | http://localhost:5173 | Shop dashboard + customer checkout (React/Vite, live reload) |
| **admin** | http://localhost:5174 | FilsPay staff console (React/Vite, live reload) |
| **api** | http://localhost:3000 | Main API. `/` gives 404 on purpose; try `/healthz`, `/readyz` |
| **postgres** | `127.0.0.1:5433` | `psql postgres://filspay:filspay_dev_password@127.0.0.1:5433/filspay` |
| settlement | internal only (8091) | Go: nightly close, payouts, scheme file |
| reporting | internal only | Worker that builds report tables |

## 3. Logins (seed data)

| Where | User | Password |
|---|---|---|
| Shop dashboard (5173) | `owner@alpharetail.example`, `owner@betadigital.example`, `finance@<shop>.example`, … | `FilsPaySeed!2026` |
| Staff console (5174) | `support@filspay.test` · `finance@filspay.test` · `superadmin@filspay.test` | `FilsPayAdminSeed!2026` |

**OTP code:** in local dev mode it is shown on the login page ("Development code: …") and in the
login reply in DevTools → Network. That is bug **A5**. Once A5 is fixed, it will appear in the API logs
(`dc logs -f api`) or in a local mail inbox instead.

**API keys:** `dc run --rm seed` prints one per shop. Use: `curl -H "Authorization: Bearer <key>" localhost:3000/v1/transactions?limit=2`

## 4. Daily use

```bash
git pull --rebase origin main     # before starting each bug
dc up -d                          # start everything
dc logs -f api                    # watch a service's logs
dc up -d --build api              # after changing apps/api, apps/reporting, db, scripts or packages
dc up -d --build settlement       # after changing apps/settlement (Go)
                                  # web/admin need no rebuild: live reload
dc run --rm migrate               # after adding a migration (rebuild migrate first: dc build migrate)
dc run --rm seed                  # reset test data to a clean state
dc down                           # stop everything (data is kept)
dc down -v                        # stop and DELETE the database (then migrate + seed again)
```

## 5. Tests

Inside Docker (no local install needed). The tests use the database, so run them one at a time
and re-seed afterwards:

```bash
dc build api
dc run --rm api npm test                                   # all TypeScript tests
dc run --rm api npx tsx --test apps/api/src/auth/otp.test.ts   # one file
dc run --rm seed                                           # restore test data
```

Go tests on the host (needs Go 1.22+):

```bash
cd apps/settlement && go test ./...
```

## 6. Problems we already hit

| Symptom | Cause | Fix |
|---|---|---|
| `Dockerfile.node: no such file` | Old checkout (before DEP-001) | `git pull` |
| `migrate` fails at 0054 or 0055 | Old checkout (before DEP-002) | `git pull`, `dc build migrate` |
| Port 5432 already in use | You have a local Postgres | We use **5433**; change with `FILSPAY_PG_PORT=5440 dc up -d postgres` |
| Browser on 5173/5174: "refused to connect" | web/admin not started | `dc up -d web admin` |
| Dashboard calls fail with CORS errors | Running Vite outside Docker without the proxy | Set `VITE_API_BASE_URL=` (empty) before `npm run dev`; the Vite proxy sends `/v1` to `localhost:3000` |
| `npm ci` fails on `argon2` / python | Building without the compile stage | Use `ops/Dockerfile.node` as committed |
| A code change doesn't show (api/settlement) | Code is copied into the image | `dc up -d --build <service>` |
| Disk full during build | Docker build cache | `docker builder prune` (frees old cache; ask before running on a shared machine) |
| Settlement runs a daily close right at start | Bug S10 (known) | Ignore for now |
