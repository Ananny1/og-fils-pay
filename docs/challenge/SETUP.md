# Setup — run FilsPay on your machine

Everything runs in Docker. You need: **Docker + Docker Compose v2**, **git**, about **4 GB free disk**.
Node 20 and Go 1.22 on the host are only needed to run tests outside Docker.

All commands run from the **repo root**. Short form used below:

```bash
alias dc='docker compose -f ops/docker-compose.yml'
```

---

## 1. First time

The organisers' way works as-is (DEP-004): from a fresh clone, **no settings file needed**:

```bash
git clone https://github.com/Ananny1/fils-pay.git && cd fils-pay/ops
docker compose up -d          # builds, starts postgres → runs migrate → then seed, api, settlement, reporting, web, admin
docker compose ps             # migrate + seed "Exited (0)", the other 6 "Up"
curl localhost:3000/readyz    # {"status":"ready"}
```

Laptop defaults come from the committed `ops/.env.dev`. To use your own secrets, copy
`ops/.env.docker.example` to `ops/.env.docker` (git-ignored); every value there **overrides**
`.env.dev`. A hosted box **must** have `ops/.env.docker` with `NODE_ENV=production`,
`OTP_DEV_EXPOSE=false` and real secrets.

From the repo root instead of `ops/`, use the alias: `dc up -d`.

**Note:** `up` re-runs the seed, which **resets the demo data**. To restart without re-seeding:
`dc up -d api settlement reporting web admin`.

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

`http://localhost:5173/` also goes to the dashboard (F0). `http://localhost:3000/` is the API, not a
website: a 404 there is normal. Every page URL is listed in `PLAN.md` → Phase F → Page checklist.

## 4. Logins (seed data)

| Where | User | Password |
|---|---|---|
| Shop dashboard (5173) | Merchant ID + email from the table below | `FilsPaySeed!2026` |
| Staff console (5174) | `support@filspay.test` · `finance@filspay.test` · `alnasser.ebra@gmail.com` | `FilsPayAdminSeed!2026` |

**Shop login needs the Merchant ID.** All 15 logins below were tested end to end (password → OTP →
logged in). Password for all: `FilsPaySeed!2026`. Merchant IDs stay the same after every re-seed.

| Shop | Merchant ID | Email | Role |
|---|---|---|---|
| Alpha Retail Co | `9972daab-2c86-459f-9d78-3fe1be4e3280` | owner@alpharetail.example | owner |
| | | finance@alpharetail.example | finance |
| Beta Digital Services | `3a1a204a-4b91-4739-b955-45e95e2e2e34` | owner@betadigital.example | owner |
| | | finance@betadigital.example | finance |
| | | support@betadigital.example | support |
| | | owner@alpharetail.example ⚠️ | owner (lands in **Alpha**, bug A2) |
| Coral Bay Traders | `fb338e02-053f-4915-85c5-846b9a76ba79` | owner@coralbaytraders.example | owner |
| Delta Marketplace Bahrain | `eebd4250-3e67-4999-9ce9-f31e75486733` | owner@deltamarketplace.example | owner |
| | | finance@deltamarketplace.example | finance |
| Delta Wholesale Traders | `ce668d19-d805-469d-bc7e-d3b1741a6f16` | eb.ipod2@gmail.com | owner |
| | | finance@deltawholesale.example | finance |
| Gamma Hospitality Group (test mode) | `185f819d-f3e8-42cf-ac7c-fc7e9516ed26` | owner@gammahospitality.example | owner |
| | | finance@gammahospitality.example | finance |
| Palm Grove Retail | `4014ed64-01ca-44c9-ba4d-3c246260e656` | owner@palmgroveretail.example | owner |
| Seef Kiosk Partners | `49287abb-c45f-4c0f-a68a-d794ccd3853a` | owner@seefkiosk.example | owner |

Staff console logins (all tested): `support@filspay.test` (support), `finance@filspay.test` (finance),
`alnasser.ebra@gmail.com` (super_admin). Password: `FilsPayAdminSeed!2026`.

**Bug A2 live demo:** log in with Beta's Merchant ID + `owner@alpharetail.example`. After the OTP
you are inside **Alpha Retail**, not Beta (`GET /v1/auth/me` shows `"displayName":"Alpha Retail Co"`).

**OTP code:** it is emailed, never shown on the page (bug **A5**, `OTP_DEV_EXPOSE=false`).
On the laptop every email lands in Mailpit: open **http://localhost:8025**. On the hosted box it is
sent by Gmail to the real address, so only `alnasser.ebra@gmail.com` (staff) and
`eb.ipod2@gmail.com` (Delta Wholesale owner) can receive codes there; the other seed emails are fake.

**API keys:** `dc run --rm seed` prints one per shop. **They change on every re-seed** (only the
Merchant IDs stay fixed), so copy them from your latest seed output. Use: `curl -H "Authorization: Bearer <key>" localhost:3000/v1/transactions?limit=2`

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
| api / seed: "WEBHOOK_SECRET_ENCRYPTION_KEY must base64-decode to exactly 32 bytes, got 34" | Old checkout (before BUG-058) | `git pull`, `dc up -d --build` |
| settlement: "SETTLEMENT_INTERNAL_TOKEN environment variable is not set" / seed fails on missing tables | Old checkout (before DEP-004) | `git pull`; `ops/.env.dev` provides laptop defaults and migrate now runs first |
| Port 5432 already in use | You have a local Postgres | We use **5433**; change with `FILSPAY_PG_PORT=5440 dc up -d postgres` |
| Browser on 5173/5174: "refused to connect" | web/admin not started | `dc up -d web admin` |
| `localhost:5173` shows "Unexpected Application Error! 404" | Old checkout (before F0) | `git pull`; or open `/dashboard` |
| Shop login fails with the right details | A comma or space copied into a field, or the browser auto-filled an old password | Type exactly: Merchant ID, `owner@alpharetail.example` (no comma), `FilsPaySeed!2026` |
| Where is the OTP? | It is emailed, not shown (A5) | Laptop: Mailpit at http://localhost:8025. Hosted: the real Gmail inbox |
| `localhost:3000` shows "Route GET:/ not found" | That's the API, not a website | Use 5173 / 5174 |
| Dashboard calls fail with CORS errors | Running Vite outside Docker without the proxy | Set `VITE_API_BASE_URL=` (empty) before `npm run dev`; the Vite proxy sends `/v1` to `localhost:3000` |
| `npm ci` fails on `argon2` / python | Building without the compile stage | Use `ops/Dockerfile.node` as committed |
| A code change doesn't show (api/settlement) | Code is copied into the image | `dc up -d --build <service>` |
| Disk full during build | Docker build cache | `docker builder prune` (frees old cache; ask before running on a shared machine) |
| Settlement runs a daily close right at start | Bug S10 (known) | Ignore for now |
