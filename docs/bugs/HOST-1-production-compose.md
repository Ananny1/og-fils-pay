> **2026-10-30 note:** this stack now lives in `ops/docker-compose.capacity.yml` (load-test and capacity stack). The live Dilmune deployment uses Sayed's `ops/docker-compose.prod.yml` (HTTPS via Dilmune Sites).

# HOST-1 — A real production stack on one small server

| | |
|---|---|
| **Severity** | High (rubric: Hosting, 10 pts) |
| **Area** | Deploy |
| **Analysis ID** | HOST-1 (sprint stream S8) |
| **Clue** | `ops/README.md`: "The hosted demo instance uses the same compose file with a different `.env`" |
| **Decision** | D-016 (4-hour sprint) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** the only compose file is the laptop stack. "Hosting" it means running Vite dev
  servers, `tsx` (TypeScript compiled at run time), Postgres on a host port, no restart policy, no
  CPU/memory caps, and a seed job that **wipes the database** every time it runs.
- **Why:** the docs claim the hosted box "uses the same compose file with a different `.env`".
  Nobody built a production variant.
- **What it breaks:** a crash means the site stays down; the API can eat the whole box; dev
  tooling and a dev web server face the internet; a redeploy that re-runs `seed` deletes every
  real payment.

## 1. The issue

`ops/docker-compose.yml` is made for a laptop:

| Laptop stack (`docker-compose.yml`) | Problem on a public server |
|---|---|
| `web`/`admin` = `npx vite` dev servers | slow, dev-only, not meant to face the internet |
| api = `npx tsx apps/api/src/index.ts` | compiles TypeScript at boot, ships all dev deps (540 MB image) |
| api published on `0.0.0.0:3000`, Postgres on `127.0.0.1:5433` | three entry points instead of one |
| no `restart:` | a crash = down until someone notices |
| no `cpus` / `mem_limit` | rubric needs api ≤ 0.5 vCPU / 512 MB, whole stack ≤ 1 vCPU / 2 GB |
| `seed` always truncates + regenerates | re-running compose wipes live data |

## 2. Why it happened

There was never a production compose file. `ops/README.md` says the hosted box "uses the same
compose file with a different `.env`" and that "apps/web and apps/admin aren't part of this
compose file" (false — they are, as dev servers). It also gives the box as "0.5 vCPU / 2 GB / 2 GB
disk" while the target is 1 vCPU / 2 GB. These are claims, not facts (reported as traps).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers | checkout down after any crash; slow pages from dev servers | High |
| Merchants | a redeploy that re-seeds deletes their payments | Critical |
| FilsPay ops | no reproducible deploy, no resource limits | High |

## 4. The fix

New files only; the laptop stack is unchanged.

| File | Change |
|---|---|
| `ops/docker-compose.prod.yml` | the hosted stack: postgres, migrate, seed (once), api, settlement, reporting, web (nginx) |
| `ops/Dockerfile.node.prod` | multi-stage: bundle the Node services to plain JS, build both SPAs; `app` target (production `node_modules` only, runs as `node`) and `web` target (nginx) |
| `ops/prod/bundle.sh` | esbuild bundles of api, reporting, migrate, seed, seed-once (native argon2/sharp stay external) |
| `ops/prod/seed-once.ts` | runs the seed only when there is no merchant yet (Q-7) |
| `ops/prod/nginx.conf`, `ops/prod/security-headers.conf` | one public port; `/` shop app, `/admin/` console (SPA fallback), `/v1` + `/healthz` → api; fast `503` + `Retry-After` when the api is down; security headers |
| `ops/.env.prod.example` (+ `.gitignore` exception) | production settings: `NODE_ENV=production`, `OTP_DEV_EXPOSE=false`, secrets |
| `apps/admin/src/router.tsx` | router `basename` from Vite's `BASE_URL` (`/` in dev, `/admin/` in the hosted build) |
| `ops/README.md` | "Hosted stack" section |

What the stack guarantees:

| Rubric need | How |
|---|---|
| One server, 1 vCPU / 2 GB | caps: api 0.5 / 512m, postgres 0.38 / 640m, nginx 0.08 / 64m, reporting 0.02 / 256m, settlement 0.02 / 128m = **1.0 vCPU / 1.6 GB** (split tuned in CAP-1) |
| API 0.5 vCPU / 512 MB | `cpus: 0.5`, `mem_limit: 512m`, `--max-old-space-size=384` |
| Restarts itself | `restart: unless-stopped` + `init: true` (tini), so a killed node process exits the container and comes back (one-off jobs `restart: "no"`) |
| Health checks | postgres `pg_isready`; api `GET /healthz`; nginx `GET /` |
| Order | postgres healthy → migrate → seed-once → api / settlement / reporting |
| Secure | only nginx is published; Postgres and api only on the private network; api runs as non-root; no dev tooling or OTP exposure; Secure cookies (TLS in front) |
| Data kept | named volumes `pgdata`, `kyc`; `synchronous_commit` stays on |
| Reproducible | lockfile `npm ci`, pinned base images, one command |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Separate `docker-compose.prod.yml` + prod Dockerfile (esbuild bundle, nginx static) | laptop stack untouched; small images (app 383 MB, web 74 MB); one public port | two compose files to keep in sync | ✅ |
| 2 | Compose override file on top of the dev file | less duplication | dev-only bits (volumes, vite commands, ports) are hard to *remove* with overrides | |
| 3 | Run `tsc` builds per workspace | "real" compiled JS | workspace packages export `.ts` sources (`main: ./src/index.ts`); needs package.json changes across the repo | |
| 4 (creative) | Serve the SPAs from the api itself (`@fastify/static`) | no nginx container | new dependency; static files would use the api's 0.5 vCPU; no fast 503 while the api restarts | |

**Why we chose #1:** no change to how the team runs things locally, and nginx gives the "turn away
fast" answer even while the api container is restarting.

## 6. Proof

Run as a separate project on port 8080 (`-p fpprod`), next to the laptop stack:

| Check | Result |
|---|---|
| `up -d --build` from empty | migrate 66 applied → seed ran → all services up, api `healthy` |
| `/`, `/dashboard/login`, `/pay/x`, `/admin/`, `/admin/merchants` (deep link) | 200 `text/html` (SPA fallback) |
| `/v1/payment-links/nope`, `/healthz`, `/readyz` | 404 JSON, 200, 200 (through nginx) |
| Headers | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`; hashed assets cached 7 days |
| Re-run `seed` on a seeded DB | `seed-once: database already has merchants, skipping seed` |
| SIGKILL the api node process | nginx answers `503` in ~1 ms for ~1.5 s, container restarts (`RestartCount` 0 → 1), then 404/200 again |
| Idle memory | api 25 MB, postgres 70 MB, nginx 13 MB, reporting 12 MB, settlement 12 MB |

```bash
cp ops/.env.prod.example ops/.env.prod   # fill in secrets; PUBLIC_PORT=8080 for a local try
docker compose -p fpprod --env-file ops/.env.prod -f ops/docker-compose.prod.yml up -d --build
```

Load, overload and crash-under-load numbers: `docs/challenge/CAPACITY.md` (CAP-1).

Existing tests changed: none.

## Follow-ups

- TLS: terminate HTTPS in front of nginx (Cloudflare / Caddy). Cookies are `Secure` in production,
  so plain `http://` login only works with `COOKIE_SECURE=false` (local test only).
- Docker does not restart an *unhealthy* (hung but alive) container by itself; CAP-2's load
  shedding keeps the api answering instead of hanging.
