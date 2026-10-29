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

## 3. Correct URLs

| What | URL |
|---|---|
| Shop dashboard (start here) | **http://localhost:5173/dashboard** → login page, then transactions |
| Shop login directly | http://localhost:5173/dashboard/login |
| Customer checkout for a payment link | http://localhost:5173/pay/`<token>` (create a link in the dashboard first) |
| Staff console | **http://localhost:5174** → login, then `/merchants` |
| API health | http://localhost:3000/healthz · http://localhost:3000/readyz |

`http://localhost:3000/` is the API, not a
website: a 404 there is normal. Every page URL is listed in `PLAN.md` → Phase F → Page checklist.

## 4. Logins (seed data)

| Where | User | Password |
|---|---|---|
| Shop dashboard (5173) | Merchant ID + email from the table below | `FilsPaySeed!2026` |
| Staff console (5174) | `support@filspay.test` · `finance@filspay.test` · `superadmin@filspay.test` | `FilsPayAdminSeed!2026` |

**Shop login needs the Merchant ID** (stays the same after every re-seed):

| Shop | Merchant ID | Users |
|---|---|---|
| Alpha Retail Co | `9972daab-2c86-459f-9d78-3fe1be4e3280` | owner@, finance@alpharetail.example |
| Beta Digital Services | `3a1a204a-4b91-4739-b955-45e95e2e2e34` | owner@, finance@, support@betadigital.example · **also owner@alpharetail.example** (same email in two shops: bug A2) |
| Coral Bay Traders | `fb338e02-053f-4915-85c5-846b9a76ba79` | owner@coralbaytraders.example |
| Delta Marketplace Bahrain | `eebd4250-3e67-4999-9ce9-f31e75486733` | owner@, finance@deltamarketplace.example (split payouts) |
| Delta Wholesale Traders | `ce668d19-d805-469d-bc7e-d3b1741a6f16` | owner@, finance@deltawholesale.example |
| Gamma Hospitality Group | `185f819d-f3e8-42cf-ac7c-fc7e9516ed26` | owner@, finance@gammahospitality.example (**test mode** shop) |
| Palm Grove Retail | `4014ed64-01ca-44c9-ba4d-3c246260e656` | owner@palmgroveretail.example |
| Seef Kiosk Partners | `49287abb-c45f-4c0f-a68a-d794ccd3853a` | owner@seefkiosk.example |

**OTP code:** in local dev mode it is shown on the login page ("Development code: …") and in the
login reply in DevTools → Network. That is bug **A5**. Once A5 is fixed, it will appear in the API logs
(`dc logs -f api`) or in a local mail inbox instead.

**API keys:** `dc run --rm seed` prints one per shop. Use: `curl -H "Authorization: Bearer <key>" localhost:3000/v1/transactions?limit=2`

## 5. Daily use

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

## 6. Tests

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

## 7. Problems we already hit

| Symptom | Cause | Fix |
|---|---|---|
| `Dockerfile.node: no such file` | Old checkout (before DEP-001) | `git pull` |
| `migrate` fails at 0054 or 0055 | Old checkout (before DEP-002) | `git pull`, `dc build migrate` |
| Port 5432 already in use | You have a local Postgres | We use **5433**; change with `FILSPAY_PG_PORT=5440 dc up -d postgres` |
| Browser on 5173/5174: "refused to connect" | web/admin not started | `dc up -d web admin` |
| `localhost:3000` shows "Route GET:/ not found" | That's the API, not a website | Use 5173 / 5174 |
| Dashboard calls fail with CORS errors | Running Vite outside Docker without the proxy | Set `VITE_API_BASE_URL=` (empty) before `npm run dev`; the Vite proxy sends `/v1` to `localhost:3000` |
| `npm ci` fails on `argon2` / python | Building without the compile stage | Use `ops/Dockerfile.node` as committed |
| A code change doesn't show (api/settlement) | Code is copied into the image | `dc up -d --build <service>` |
| Disk full during build | Docker build cache | `docker builder prune` (frees old cache; ask before running on a shared machine) |
| Settlement runs a daily close right at start | Bug S10 (known) | Ignore for now |
