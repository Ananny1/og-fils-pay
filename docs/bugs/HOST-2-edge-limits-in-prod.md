# HOST-2 — Hosted stack: edge limits, proxy trust, seed passwords, capacity re-measured

| | |
|---|---|
| **Severity** | Major (cheap DoS of checkout) + 3 minor |
| **Area** | Deploy · Security |
| **Analysis ID** | HOST-2 (review of HOST-1 / CAP-1 / SEC-5) |
| **Clue** | Reviewer: "one IP holding 28 slow connections makes every buyer get 503" |
| **Commit** | `fix(HOST-2)` × 3: edge limits · env/compose/seed · capacity |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** on the hosted box, one person with one laptop could stop every checkout by
  opening 28 slow requests; the box also didn't trust its own proxy, seeded users with passwords
  that are in git, and gave the settlement service almost no CPU.
- **Why:** SEC-5's per-IP rules were written but never included in `ops/prod/nginx.conf`; the
  only limit there was one global `limit_conn api_in_flight 28`, which counts a request from the
  moment its headers arrive — including requests that then send their body 1 byte at a time.
- **What it breaks:** checkout availability (all buyers get 503), the SEC-1 login limiter (every
  client looked like nginx), and the secrecy of the seeded staff/shop accounts.

## 1. The issue

| # | Finding | Proof (before) |
|---|---|---|
| 1 | No per-IP limits, default 60 s timeouts, global cap filled by slow clients | One container sent 40 `POST …/pay` with the body trickled 1 byte / 5 s: it held all 28 slots for 45 s; 5 buyers from another IP got **27,084 × 503, 0 paid** |
| 2 | `TRUST_PROXY` not set in `ops/.env.prod.example` | the api would see nginx's IP for everyone, so SEC-1's per-IP login limit hits all users at once |
| 3 | `seed-once` creates users with `FilsPaySeed!2026` / `FilsPayAdminSeed!2026` (committed in `db/seed/generate.ts`) | anyone reading the repo can log in to a fresh hosted box (with the OTP mail) |
| 4 | settlement and reporting at 0.02 vCPU | daily batch 7.7 s, `rebuild-balances` 5.2 s on a small DB: grows with volume towards the api's 30 s internal-call timeout |

## 2. Why it happened

`ops/prod/nginx.conf` (HOST-1/CAP-1) predates SEC-5; SEC-5 shipped its files with an include
recipe (`ops/nginx/security.conf` header) but nobody wired them in. The CAP-1 comment said "not per
IP: a load test comes from a single address" — true, but it left no per-IP protection at all, and
`limit_conn` runs before nginx reads the body. `generate.ts` documents its passwords as "local
development and CI only", but HOST-1's `seed-once` runs it on the hosted DB.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Buyers | any one attacker IP could make checkout answer 503 for everybody | High |
| Merchants / staff | seeded accounts on a fresh hosted box had public passwords; login limiter keyed on nginx's IP | High |
| FilsPay ops | slow settlement batch at 0.02 vCPU | Low |

## 4. The fix

| File | Change |
|---|---|
| `ops/prod/nginx.conf` | includes `security.conf` (http) and `security-server.conf` (server); global cap moved from `limit_conn` to the upstream: `server api:3000 resolve max_conns=28` (+ keepalive); `/v1/` no longer sets its own `proxy_set_header`/`limit_conn` (inherits the edge's, so `X-Forwarded-For` is overwritten with the real IP) and repeats `error_page 429` |
| `ops/nginx/security.conf` | new `checkout` class (`/v1/payment-links/:token[/pay]`): **no** per-IP rate, own in-flight cap; refunds class fixed to the real path `/v1/merchants/:id/refunds` (was `/v1/refunds`, which no longer exists) |
| `ops/nginx/security-server.conf` | `limit_conn filspay_conn_checkout 64`; buffered access log (CAP-1); 6 MB body for `/v1/admin/adjustment-imports` (the api allows 5 MB; the 1 MB edge cap would cut it) |
| `ops/Dockerfile.node.prod` | copies both SEC-5 files into the nginx image; `worker_connections 4096` |
| `ops/nginx/test/checks.sh` | refunds path; "one IP is not cut on checkout" check (SEC-5 edge test: 30/30 pass) |
| `ops/.env.prod.example` | `TRUST_PROXY=true`; `SEED_USER_PASSWORD` / `SEED_ADMIN_PASSWORD` |
| `ops/docker-compose.capacity.yml` | settlement 0.02 → 0.05, postgres 0.38 → 0.35 (total stays 1.0); comment: api has no `ports:` because TRUST_PROXY needs it |
| `db/seed/generate.ts` (+ `seedPasswords.test.ts`, root `npm test`) | `seedPasswords(env)`: with `NODE_ENV=production` both passwords must come from env, 12+ chars, not the committed ones, not equal — else the seed refuses before touching the DB. Dev/CI unchanged |
| `ops/loadtest/*`, `docs/challenge/CAPACITY.md`, `DDOS.md` | 429 counted as shed; `BLOCK` per step; slow-client script; new numbers |

Verified: api and Postgres have **no** published port (`docker port` empty, only nginx's); the
api recorded a login failure from the real client IP `172.26.0.1` while the client sent
`X-Forwarded-For: 6.6.6.6`; `nginx -t` passes inside the built `filspay-web:prod` image.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Global cap on the upstream (`max_conns`) + per-IP in-flight cap (64) on checkout, no per-IP rate on checkout; SEC-5 rates everywhere else | slow clients can't touch the api; one IP still reaches full capacity (judges); 503 vs 429 tells the layers apart | card testing on checkout must be stopped in the api | ✅ |
| 2 | Keep `limit_conn 28`, add per-IP `limit_conn` below it (e.g. 8) | simple | one IP (a judge's load test, an office NAT) capped at 8 buyers ≈ ⅓ of capacity; slow clients still eat global slots | ❌ |
| 3 | Per-IP rate on checkout (tried 100/s burst 200) | stops one-IP floods | **measured**: one IP at 25 buyers fell from ~19 to 7 paid/s (42,622 × 429) — shed buyers retry at once and empty the bucket for the admitted ones | ❌ |
| 4 | Document password rotation instead of env passwords | no code | first boot still creates public-password accounts | ❌ |

## 6. Proof

| Check | Result |
|---|---|
| Capacity, one IP (run `f`, fresh DB) | 15 users: **21.1 paid/s, p95 1.05 s**; 20 users: 22.5/s, p95 1.29 s; 0 wrong; 0 × 429 |
| (b) Overload 60/s (3×) | sheds **median 2.0 ms**, all with `Retry-After`; 0 wrong; 0 × 429 |
| (c) api SIGKILL mid-load | restarted (RestartCount 1), `/healthz` 200 after 2.1 s; DB: 927 paid = 927 captured, 0 lost, 0 doubled |
| (d) one slow-client IP | before: victims 0 paid / 27,084 × 503 · after: attacker held 64, got 36 × 429; victims **231 paid, 0 shed**; 500 header-trickling connections closed at 10 s, victims 185 paid, 0 shed |
| Settlement CPU | `run-batch` 7.7 s → 2.2 s, `rebuild-balances` 5.2 s → 1.6 s (0.02 → 0.05) |
| Reporting at 0.02 | backlog ≤ 27 events in the final run (≤ ~350 on a grown DB), always caught up |
| Seed | hosted users verify against the env passwords, not the committed ones; `seedPasswords.test.ts` 3/3 |
| API suite (fresh `filspay_h2`) | **502 / 502** pass; `tsc -p db` clean; SEC-5 edge test 30 / 30 |

Full numbers and the reproducible method: `docs/challenge/CAPACITY.md`.

**On the real server:** set `TRUST_PROXY=true`, `SEED_USER_PASSWORD`, `SEED_ADMIN_PASSWORD` in
`ops/.env.prod` **before the first boot** (the seed runs once). A box already seeded with the dev
passwords: if it holds no real data, `down -v` and boot again; otherwise change the passwords of
the seeded accounts. If a CDN / load balancer is put in front of nginx, enable the
`set_real_ip_from` block in `ops/nginx/security.conf` for its ranges only, or every client shares
one IP.
