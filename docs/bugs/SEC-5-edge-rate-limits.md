# SEC-5 — Edge protection: nginx rate and connection limits

| | |
|---|---|
| **Severity** | High |
| **Area** | Security · Deploy (availability) |
| **Analysis ID** | ENH-005 / CAP-2 (edge part) |
| **Clue** | Security sprint plan: floods, brute force and load tests are on the judges' list |
| **Decision** | D-016 |
| **Commit** | see `git log --grep SEC-5` |
| **Owner** | Ebrahim |
| **Evidence** | `sh ops/nginx/test/edge-test.sh` — 28 checks + access-log check |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** nothing in front of the API limited how fast or how often one client can call it.
- **Why:** the stack had no edge rules at all: any IP could send unlimited requests, hold unlimited slow connections, post large bodies, fake `X-Forwarded-For`, and see the nginx version.
- **What it breaks:** one script could brute-force logins, card-test the pay endpoint, or tie up every connection, and the API (and Postgres) would take the whole load.

## 1. The issue — what was wrong

With a plain nginx front (empty includes), the test shows: 60 back-to-back API
calls all get 200, 20 login calls in a row all get 200, a client-sent
`X-Forwarded-For: 6.6.6.6` reaches the API as the "real" IP, `PUT` and
`/.env` are passed through, and `Server: nginx/1.27.5` is advertised.

Reproduce: empty `ops/nginx/security.conf` and `security-server.conf`, run
`sh ops/nginx/test/edge-test.sh` → **20 failed** checks.

## 2. Why it happened — the root cause

`ops/` only had the dev compose; there was no edge configuration at all, so
every abuse limit depended on the Node.js process, which is the most expensive
place to say "no" (and which trusts whatever IP header arrives once
`TRUST_PROXY=true` is set behind a proxy).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Checkout slow or down during a flood | High |
| Merchants | Login brute force; dashboard down during a flood | High |
| FilsPay (finance / ops) | API + Postgres overloaded by one IP; no log line shows who | High |
| Acquirer / card scheme / partners | Card testing through the pay endpoint | Medium |

## 4. The fix

| File | Change |
|---|---|
| `ops/nginx/security.conf` | http level: maps that put each path in one class (auth / pay / bank / api / static), per-IP `limit_req_zone`s, `limit_conn_zone`, 429 status, `log_format filspay_edge` with `$limit_req_status`/`$limit_conn_status`, `server_tokens off`, commented `set_real_ip_from` for a future load balancer |
| `ops/nginx/security-server.conf` | server level: the limits, JSON 429 + `Retry-After`, 10 s header/body/send timeouts, keep-alive 15 s, 1 MB body (9 MB only for the KYC upload location), header buffers, `X-Real-IP` / `X-Forwarded-For` **overwritten** with `$remote_addr`, method allowlist, dotfile 404 |
| `ops/nginx/test/edge.conf`, `upstream.conf`, `checks.sh`, `edge-test.sh` | throwaway test harness in stock `nginx:1.27-alpine` |
| `docs/challenge/DDOS.md` | the layers in plain words, thresholds and why, and what needs the cloud provider |

Two files because nginx only allows zones at http level and access rules at
server level. Nothing in the stack is changed: the production compose (stream
S8) includes these files; the header of `security.conf` shows how.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Standalone nginx include files, one class per path via `map`, tested in throwaway containers | No new software, cheapest place to reject, works whatever the prod compose looks like, every request counted in exactly one zone | Per nginx instance (fine for an edge; shared limits live in Postgres, SEC-1) | ✅ |
| 2 | Rate limits only in the API (`@fastify/rate-limit`) | One place, can key on account | New dependency; Node still parses every flood request; in-memory per instance or extra DB load | |
| 3 | Edit the prod compose's nginx directly | Fewer files | Owned by another stream (S8), merge conflict, not testable alone | |
| 4 | Rely only on cloud DDoS / WAF | Handles volumetric attacks | Not available locally, no per-path logic, judges test the app itself | |

**Why we chose #1:** it stops the flood before Node.js or Postgres see it, adds
no dependency, and is proven by a repeatable script.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| Normal rate (5/s API, ~1/s login) all 200 | `ops/nginx/test/checks.sh` | ✅ | ✅ |
| API flood 60 back-to-back → ~21 pass, rest 429 | same | ❌ 60 × 200 | ✅ 26 × 200, 34 × 429 |
| Login / admin OTP flood → ≤ 6 pass | same | ❌ 20 × 200 | ✅ 6 × 200, 14 × 429 |
| Pay flood → ~11 pass | same | ❌ 30 × 200 | ✅ 11 × 200 |
| 429 is JSON `rate_limited` + `Retry-After` | same | ❌ | ✅ |
| Spoofed `X-Forwarded-For` / `X-Real-IP` dropped | same | ❌ 6.6.6.6 reached API | ✅ real IP only |
| `TRACE`, `PUT` → 405; `PATCH`, `OPTIONS` pass | same | ❌ PUT 200 | ✅ |
| `/.env`, `/.git/config`, `/assets/.htpasswd` → 404; `/.well-known/` kept | same | ❌ 200 | ✅ |
| 2 MB JSON → 413; 2 MB / 9 MB KYC → 200; 12 MB KYC → 413 | same | ❌ KYC 413 | ✅ |
| `Server: nginx` without version | same | ❌ `nginx/1.27.5` | ✅ |
| 35 slow downloads at once → 20 served, 15 × 429 | same | ❌ | ✅ |
| Access log tags `limit_req=REJECTED` / `limit_conn=REJECTED` | `ops/nginx/test/edge-test.sh` | ❌ 0 | ✅ 89 / 15 |
| `nginx -t` with the stock nginx.conf | same | ✅ | ✅ |

```bash
sh ops/nginx/test/edge-test.sh     # RESULT: 28 passed, 0 failed + log check PASS
```

Existing tests changed (and why): none. No API code changed, so the TS and Go
suites are unaffected.
