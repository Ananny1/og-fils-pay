# Capacity — checkout load test

## Setup
- Stack: `ops/docker-compose.prod.yml` on Docker Desktop with the real limits: API 0.5 vCPU /
  512 MB, the whole stack within 1 vCPU / 2 GB, nginx in front, Postgres not published.
- Scenario (`ops/loadtest/checkout.js`, k6 via `ops/loadtest/run.sh step`): links are created up
  front with a merchant API key; each virtual user (VU) opens a link (`GET`) and pays it (`POST`
  with a test card), then takes the next link. Steps of 10 → 100 VUs, about 45 s each.
- The acquirer is a simulator with 100–400 ms latency per call; a payment does two calls
  (authorize + capture), so a single payment can't be faster than about 0.5 s. That floor is the
  acquirer, not our stack.

## Results

**Before the hot-path indexes** (run `asis`):

| VUs | paid/s | pay p95 | total p95 | shed |
|---|---|---|---|---|
| 10 | 17.7 | 742 ms | 744 ms | 0 % |
| 20 | 22.9 | 1401 ms | 1406 ms | 0 % |
| 30 | 19.6 | 2405 ms | 2601 ms | 0 % |
| 40 | 14.6 | 3500 ms | 3801 ms | 0 % |
| 60 | 11.3 | 5198 ms | 6102 ms | 0 % |
| 80 | 2.1 | 2300 ms | 2989 ms | 97 % |

Throughput fell as load rose: every payment ran sequential scans on the tables it reads, so
Postgres CPU, not the API, was the bottleneck.

**With the hot-path indexes** (run `indexed`; the indexes are fix BUG-038 on branch
`fix/checkout`):

| VUs | paid/s | pay p50 | pay p95 | pay p99 | total p95 | errors | shed |
|---|---|---|---|---|---|---|---|
| 10 | 17.8 | 508 ms | 726 ms | 785 ms | 727 ms | 0 % | 0 % |
| 20 | **36.5** | 509 ms | 733 ms | 957 ms | 735 ms | 0 % | 0 % |
| 30 | **37.8** | 704 ms | 936 ms | 1013 ms | 999 ms | 0 % | 0 % |
| 40 | 36.6 | 911 ms | 1290 ms | 1510 ms | 1406 ms | 0 % | 0 % |
| 50 | 33.3 | 1153 ms | 1800 ms | 4402 ms | 2038 ms | 0.65 % | 0 % |
| 60 | 31.3 | 1320 ms | 2293 ms | 9327 ms | 2704 ms | 0 % | 0 % |
| 80 | 8.8 | 1077 ms | 1472 ms | 1611 ms | 1747 ms | 0 % | 92 % |

Totals: 12,128 paid, 0 double charges, 27 failures out of about 13,000 payments (all at 50+ VUs).
Peak memory: API about 95 MB of 512 MB, Postgres about 120 MB.

## Our estimate

**About 35 completed checkouts per second, with about 30 people paying at the same time, at p95
under 1 second.** Beyond about 40 concurrent payers latency rises (p95 1.3–2.3 s) while throughput
stays around 31–37/s. Beyond about 70 the API sheds the excess with an immediate `503` +
`Retry-After` (OPS-002) instead of queueing: the shed requests return in milliseconds, and the
payments it does accept still complete correctly.

This holds only with the BUG-038 indexes merged. Without them the same box peaks at about 23
checkouts/s at 20 payers and degrades from there.

## What limits it next
1. The acquirer's own latency (about 0.5 s per payment) — it sets the floor, not the ceiling.
2. Postgres CPU on the shared 1 vCPU (peaked about 40 % at the knee).
3. The 27 errors at 50+ VUs were 500s under heavy contention; they are not double charges (each
   link has at most one capture) but should be investigated before a higher estimate is quoted.

## Reproduce
```
cp ops/.env.prod.example ops/.env.prod   # fill in the secrets
docker compose -p filspay -f ops/docker-compose.prod.yml up -d --build
docker compose -p filspay -f ops/docker-compose.prod.yml run --rm migrate
docker compose -p filspay -f ops/docker-compose.prod.yml run --rm seed      # prints API keys
API_KEY=<a printed key> MERCHANT_ID=<its merchant id> ops/loadtest/run.sh step
```
