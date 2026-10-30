# DDoS and abuse protection — how FilsPay stays up

Plain-words guide to the layers that stop floods, brute force and slow
clients. The edge rules are in `ops/nginx/` (SEC-5); proof is
`sh ops/nginx/test/edge-test.sh`.

## The layers, outside in

```
 internet
    │
 [0] cloud network protection   volumetric floods (Gbit/s, SYN, UDP)   ← cloud provider
    │
 [1] edge nginx (SEC-5)         per-IP rate + connection limits, slow   ← ops/nginx/
    │                           clients, big bodies, bad methods → 429
 [2] API limiter (SEC-1)        per-IP / per-account limits on login and  ← apps/api, Postgres
    │                           OTP, shared by every API instance
 [3] overload valve (CAP-2)     API too busy → fast 503 + Retry-After     ← apps/api
    │                           instead of queueing until timeouts
 [4] alerts                     edge log `limit_req=REJECTED` spikes,     ← monitoring
                                429/503 rates, p95 latency
```

| Layer | Stops | Doesn't stop |
|---|---|---|
| 0 Cloud | Huge traffic that fills the network pipe before it reaches any server | Normal-looking HTTP abuse |
| 1 Edge nginx | One IP sending too many requests, too many connections, slow uploads (Slowloris), huge bodies, `TRACE`/`PUT`, `/.env` probes | Many IPs each sending a little (botnet) |
| 2 API limiter | Password/OTP guessing spread over time, per merchant account, across all API instances | Floods (the edge does that cheaper) |
| 3 Overload valve | A crowd of real users that is bigger than the servers | Anything — it only fails fast instead of falling over |
| 4 Alerts | Nothing by itself; tells a person to act (block a range, scale up, call the cloud provider) | — |

**Why several layers:** each one is cheap where it sits. nginx rejects a flood
for almost no CPU, before Node.js or Postgres ever see it. The API limiter
knows things nginx can't (which account, which OTP). The valve protects the
database when the traffic is real.

## Edge thresholds (per client IP) and why

| Traffic | Paths | Rate | Burst | Why this number |
|---|---|---|---|---|
| Login / OTP | `/v1/auth/*`, `/v1/admin/auth/*` | 1 / s | 5 | A person needs ~3 calls to log in. Guessing needs thousands. |
| Payments | `/v1/payment-links/:token/pay`, `/v1/refunds` | 3 / s | 10 | A checkout is 1–2 calls. Stops card-testing scripts. |
| Bank callbacks | `/v1/acquirer/*` | 50 / s | 100 | The acquirer sends batches from a few IPs. In production also allowlist its IP range. |
| Other API | `/v1/*` | 10 / s | 20 | A dashboard page fires ~5–10 API calls at once. |
| Dashboards | everything else (HTML, JS, CSS) | 30 / s | 60 | First load pulls a handful of files. |
| Connections | all | 20 open | — | A browser opens about 6. |

"Burst" = how many extra requests are allowed at once before the rate kicks
in. Above it, the answer is an immediate **429** with
`{"error":"rate_limited"}` and `Retry-After: 1` — the same error shape as the
API, so the dashboards show the same "slow down" message.

Other edge rules:

| Rule | Value | Stops |
|---|---|---|
| Header / body / send timeout | 10 s between packets | Slowloris (holding connections open by sending very slowly) |
| Keep-alive | 15 s | Idle connections eating slots |
| Body size | 1 MB (KYC upload: 9 MB) | Memory exhaustion with huge bodies. 1 MB = the API's own JSON limit; KYC files are capped at 8 MiB by the API |
| Header size | 4 × 8 KB | Oversized headers / cookies |
| Methods | GET, HEAD, POST, PATCH, DELETE, OPTIONS → else 405 | `TRACE`, `PUT`, WebDAV probing |
| Dotfiles | `/.env`, `/.git/...` → 404 (`/.well-known/` kept) | Leaking config or source |
| Version | `Server: nginx` (no number) | Attackers matching known bugs to the version |
| Client IP | `X-Real-IP` and `X-Forwarded-For` are **overwritten** with the real address | A client faking its IP to dodge the API limiter (SEC-1) or the audit log |

429 (not 503) is used at the edge on purpose: 503 belongs to the API's
overload valve, so the two can be told apart in logs and alerts.

## Seeing a flood

Every access-log line carries the limiter result:

```
172.27.0.4 [...] "GET /v1/transactions HTTP/1.1" 429 66 rt=0.000 class=api limit_req=REJECTED limit_conn=- ...
```

- `docker logs <nginx> | grep -c REJECTED` — how many were cut.
- `grep REJECTED | awk '{print $1}' | sort | uniq -c | sort -rn | head` — top offending IPs.
- Alert when REJECTED lines per minute jump (e.g. > 100/min) or 429/503 share > 5 %.

## What this does NOT cover — real DDoS

nginx limits work **per IP, per server**. They are rule-based protection, not
DDoS protection on their own:

- A **volumetric** attack (gigabits of junk, SYN or UDP floods) fills the
  network link before nginx reads a byte. Only the **cloud provider's network
  protection** in front (e.g. AWS Shield / Cloudflare / Azure DDoS Protection,
  or the Bahrain host's equivalent) can absorb that. Production must have it.
- A **botnet** of thousands of IPs, each staying under the per-IP limits,
  passes the edge. The overload valve (layer 3) keeps the API answering fast,
  and the cloud WAF / bot rules are the real answer.
- With several nginx instances, each keeps its own counters (10 MB per zone,
  ~160k IPs, oldest evicted first). That is fine for an edge: the shared,
  exact limits that matter (login/OTP) live in Postgres in the API (SEC-1).
- If a cloud load balancer is put in front of nginx, turn on the
  `set_real_ip_from` block in `ops/nginx/security.conf` for the balancer's
  range only, or every client will look like the balancer.

## How to include it (for the production compose)

See the header of `ops/nginx/security.conf`. In short: include
`security.conf` at http level, name the API upstream `filspay_api`, include
`security-server.conf` as the first line of the server block, and don't set
`limit_req` / `proxy_set_header` / `access_log` inside your own locations
(nginx would drop the inherited ones).
