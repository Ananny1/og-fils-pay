# FilsPay capacity — checkout load test (CAP-1)

**Our estimate for the judges:** the hosted stack (1 vCPU / 2 GB, api 0.5 vCPU / 512 MB) serves
about **20 buyers checking out at the same time, non-stop — about 20 paid checkouts per second
(≈ 1,200 per minute)** with every payment correct and **p95 checkout time ≈ 1.2 s**.
Past that it turns the extra buyers away in **~2 ms with `503` + `Retry-After`**, keeps the
admitted ones at normal speed, restarts itself after a crash, and loses no committed data.

> Why not "p95 < 500 ms": the payment simulator waits 100–400 ms on *each* of authorize and
> capture (`ACQUIRER_LATENCY_MIN/MAX_MS`), so one checkout with **zero** load already takes
> ~0.55 s. Our "fast" = p95 under ~2.2× that floor (≤ 1.25 s).

## 1. The scenario

`ops/loadtest/checkout.js` (k6 0.54.0) — one iteration = one buyer:

1. `GET /v1/payment-links/:token` (checkout page loads the link)
2. `POST /v1/payment-links/:token/pay` with a test card and a fresh `Idempotency-Key`

Each iteration pays its **own** unpaid 1.500 BD link (`plink_lt_<run>_<n>`, created with
`ops/loadtest/make-links.sql`). Outcomes: `paid` (200 + `status: paid` + `amountFils: 1500`),
`declined` (402/502: the simulator declines/errors ~2% on purpose — a correct answer),
`shed` (503), `wrong` (anything else). After each run `ops/loadtest/verify.sql` checks the DB:
every paid link has exactly one captured transaction of the right amount, and no captured
transaction is missing from its link.

Target: the production stack (`ops/docker-compose.prod.yml`, HOST-1) as its own compose project
on port 8080, on the laptop; all limits enforced by Docker (`cpus`, `mem_limit`).

## 2. Results (final settings)

### Steady load (closed model: N users, each starts a new checkout as soon as one ends)

| Users | Paid / s | Checkout p50 | **p95** | p99 | Declined (correct) | Shed | Wrong |
|---|---|---|---|---|---|---|---|
| 10 | 16.5 | 0.59 s | 0.83 s | 0.98 s | 25 | 0 | **0** |
| 15 | 19.0 | 0.72 s | 1.21 s | 1.48 s | 30 | 0 | **0** |
| **20** | **23.2** | 0.81 s | **1.20 s** | 1.39 s | 39 | 0 | **0** |
| 25 | 22.8 | 0.98 s | 1.39 s | 1.59 s | 39 | 7,820 (p95 **3 ms**) | **0** |

The knee is at ~20 users / ~23 paid/s: more users add no throughput; above it the extra ones are
shed in milliseconds instead of everybody slowing down. DB check (run `i`, 3,719 paid):
0 paid-without-transaction, 0 wrong amount, 0 captured-but-not-on-a-link.

### Overload + crash (open model: 60 new buyers per second = ~3× capacity, 60 s)

`PROFILE=overload RATE=60`; in the middle of the run the api's node process was **SIGKILLed**
(`kill -9`, as an OOM kill would do).

| Metric | Result |
|---|---|
| Paid | 1,299 (21.4 / s — full capacity kept under 3× load) |
| Paid checkout p95 | 1.57 s |
| Shed (`503` + `Retry-After`) | 2,254 — **median 1.6 ms, p95 49 ms**; every one had `Retry-After` |
| Wrong answers / timeouts | **0** |
| api container | restarted by itself (`RestartCount` +1); nginx answered `503` in ~2 ms while it was down; back in ~1.5 s |

### Database restart

Postgres SIGKILLed with 18,164 paid links → restarted → **18,164** paid links, api reconnected
by itself (`synchronous_commit` on, named volume).

### Earlier runs (what changed the numbers)

| Run | Change | Paid / s at the knee | Shed p50 |
|---|---|---|---|
| a | first prod stack (pool 5→10, in-flight 64, postgres 0.3 vCPU) | 9.7 | 96 ms |
| b | + CAP-3 indexes (ledger seq scans 22,760 → 0) | 12.2 | 99 ms |
| c | postgres 0.4 vCPU, pool 16, in-flight 24 | 18.6 | 3 ms |
| e | + nginx 1 worker (was one per host core, 46% of periods throttled) | — | — |
| h/i | + nginx global in-flight cap, api request logs off in production | **21–23** | **1–2 ms** |

## 3. What we tuned and why

| Setting | Value | Why |
|---|---|---|
| CPU split | api 0.5 · postgres 0.38 · nginx 0.08 · reporting 0.02 · settlement 0.02 = **1.0** | Postgres, not the api, was the first wall (each payment = ~20 statements + ledger trigger); api 0.5 is fixed by the rubric |
| `PG_POOL_MAX` | 16 | a payment holds its DB connection across both acquirer waits (`withTransaction` around `acquirer.authorize`), so connections — not CPU — limit concurrency |
| `API_MAX_IN_FLIGHT` | 24 | a bit above the pool, so admitted requests barely queue; the rest get 503 at once (CAP-2) |
| nginx `limit_conn` (global, not per-IP) | 28 on `/v1` | sheds in C before the request reaches Node; a load test comes from one IP, so no per-IP limit |
| nginx `worker_processes` | 1 | default "auto" = one per host core, which under a 0.08 CPU cap mostly waits |
| api request logging | off when `NODE_ENV=production` | two JSON log lines per request were a large share of 0.5 vCPU; nginx keeps the access log, errors still logged |
| `PG_POOL_CONNECTION_TIMEOUT_MS` | 2000 | a request that still can't get a connection gets 503, not a 5 s wait + 500 |

## 4. Known limits (honest list)

- **Crash between capture and finalize (found here):** in the crash run, 1 transaction was
  captured but its link was not marked paid (`paymentLinks/pay.ts`: claim → authorize → capture
  → finalize are separate commits). 23 links were left `reserved`; after
  `PAYMENT_LINK_RESERVATION_TIMEOUT_SECONDS` (60 s) they become payable again, so that one buyer
  could be charged twice. Fix idea: finalize the link in the same DB transaction as the capture,
  or a recovery job that links orphaned captures before re-opening a reservation. Not fixed in
  this stream (reported to the organiser).
- `acquirer/simulator.ts` keeps every idempotency result in in-memory `Map`s with no eviction; at
  this rate the api grows slowly (34 → 60 MB per run). A restart clears it; a long-running box
  would need eviction.
- A flood of clients that retry instantly with no back-off (200 users, ~1,300 req/s) saturates
  nginx's 0.08 vCPU: answers stay correct (0 wrong payments, DB consistent) but sheds slow to
  ~100 ms and paid throughput drops. Clients that honour `Retry-After` avoid this.
- Numbers are from a laptop with Docker CPU caps; the real 1-vCPU VM may differ ±20%.

## 5. How to reproduce

```bash
cp ops/.env.prod.example ops/.env.prod      # set secrets; PUBLIC_PORT=8080, COOKIE_SECURE=false for a local try
docker compose -p fpprod --env-file ops/.env.prod -f ops/docker-compose.prod.yml up -d --build

# test links (any run name; one block per run)
docker exec -i fpprod-postgres-1 psql -U filspay -d filspay -v run=i -v count=40000 < ops/loadtest/make-links.sql

# capacity steps (users per step, 45 s each)
sh ops/loadtest/steps.sh i 45s 10 15 20 25

# overload: 60 arrivals/s; kill the api in the middle from another shell
docker run --rm --network host -v "$PWD/ops/loadtest:/lt" grafana/k6:0.54.0 run \
  -e BASE=http://localhost:8080 -e RUN=h -e PROFILE=overload -e RATE=60 -e DURATION=60s /lt/checkout.js
docker exec fpprod-api-1 node -e 'process.kill(7, "SIGKILL")'   # node's pid under tini (check with docker top)

# correctness
docker exec -i fpprod-postgres-1 psql -U filspay -d filspay -v run=i < ops/loadtest/verify.sql

docker compose -p fpprod --env-file ops/.env.prod -f ops/docker-compose.prod.yml down -v
```
