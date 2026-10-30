# CAP-2 — Turn away excess load fast (503 + Retry-After), don't time out

| | |
|---|---|
| **Severity** | High (rubric: Capacity, 20 pts — "turn away the excess") |
| **Area** | Deploy · API |
| **Analysis ID** | CAP-2 (sprint stream S8) |
| **Clue** | `apps/api/src/db/pool.ts`: pool `max: 5`, `connectionTimeoutMillis: 5000`; no limit on requests in flight |
| **Decision** | D-016 (4-hour sprint) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** when more buyers arrive than the api can serve, it accepts all of them. They
  queue for one of 5 database connections; after 5 s each one fails with **500 internal_error**.
- **Why:** nothing limits the work in flight, and a "pool full" error is treated as an unknown
  crash.
- **What it breaks:** under a spike *everyone* gets slow, then many get a 500 that looks like a
  bug (and invites blind retries). The rubric wants fast `429/503` with `Retry-After`.

## 1. The issue

Reproduce: hold every pooled connection (or send far more pay requests than the box can run) and
call any `/v1` route. The request hangs for `PG_POOL_CONNECTION_TIMEOUT_MS` (5 s), then:

```
500 {"error":"internal_error"}      log: "timeout exceeded when trying to connect"
```

## 2. Why it happened

- `app.ts` has no admission control: Fastify takes every connection and every request starts work.
- `plugins/errorHandler.ts` only knows `AppError`, validation and upload errors; pg-pool's
  `timeout exceeded when trying to connect` falls through to the generic `500`.
- A payment holds its pooled connection across both simulated acquirer calls (100–400 ms each,
  `payments/authorize.ts` / `capture.ts` run inside `withTransaction`), so the pool fills quickly.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers | checkout hangs, then "something went wrong" | High |
| Merchants | lost sales during a spike | Medium |
| FilsPay ops | 500s in logs that are really "busy"; no back-pressure signal for clients | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/plugins/loadShedding.ts` (new) | `onRequest` hook counts requests in flight; over `API_MAX_IN_FLIGHT` → `503 {"error":"service_unavailable"}` + `Retry-After` at once. Slot returned on the response's `close` (finished **or** client gone). `/healthz` and `/readyz` are never shed. |
| `apps/api/src/app.ts` | register it first, before cookies/multipart/routes |
| `apps/api/src/config.ts` | `apiMaxInFlight` (`API_MAX_IN_FLIGHT`, default 64, 0 = off), `apiRetryAfterSeconds` (`API_RETRY_AFTER_SECONDS`, default 1) |
| `apps/api/src/plugins/errorHandler.ts` | pool wait timeout / connect timeout / `ECONNREFUSED` / `57P03` → `503` + `Retry-After` instead of `500` |
| `ops/docker-compose.prod.yml`, `ops/.env.prod.example` | production values (tuned in CAP-1) |

No new npm dependency. A shed request costs one counter check: no body parsing, no DB, no auth.

Why it is safe for money: a shed request does nothing at all, and a request that fails waiting for
the pool fails *before* its transaction starts, so nothing is half-written. The buyer's retry with
the same `Idempotency-Key` is handled by the existing idempotency logic.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | In-flight cap in an `onRequest` hook + map pool-timeout to 503 | no dependency; O(1); protects every route; health checks exempt | a fixed number must be tuned per box | ✅ |
| 2 | `@fastify/under-pressure` (event-loop delay / heap) | adaptive | new dependency (sprint rule: prefer none); reacts after the loop is already slow | |
| 3 | Only lower `PG_POOL_CONNECTION_TIMEOUT_MS` | one env var | still a 500 and still a wait; the event loop still takes unlimited work | |
| 4 (creative) | nginx `limit_conn`/`limit_req` in front | sheds before Node at all | judges load-test from one IP, so per-IP limits would hit them unfairly; nginx can't see pool state | |

**Why we chose #1:** it answers in about 1 ms under overload, keeps accepted requests at normal
speed, and needs no new package. nginx still adds a fast 503 when the api is down (HOST-1).

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `requests over API_MAX_IN_FLIGHT get an immediate 503 with Retry-After; health checks are never shed` | `apps/api/src/plugins/loadShedding.test.ts` | ❌ fails (`apiMaxInFlight` undefined; third request is served) | ✅ passes |
| `a request that cannot get a DB connection in time gets 503 + Retry-After, not a 500` | same | ❌ fails (`actual: 500`, after the pool timeout) | ✅ passes |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -T \
  -e DATABASE_URL=postgres://filspay:filspay_dev_password@postgres:5432/filspay_s8 \
  -v "$PWD/apps/api/src:/app/apps/api/src" api npx tsx --test apps/api/src/plugins/loadShedding.test.ts
```

Live numbers under overload (k6 against the hosted stack): `docs/challenge/CAPACITY.md`.

Existing tests changed: none.
