# OPS-002 — API overload protection: load shedding, DB timeouts, request limits

| | |
|---|---|
| **Severity** | High (availability under load) |
| **Area** | Deploy / Availability |
| **Analysis ID** | — |
| **Clue** | Hosting brief: 0.5 vCPU / 512 MB API must "turn away excess quickly" |
| **Decision** | — |
| **Commit** | see `git log --grep OPS-002` |
| **Status** | ✅ done |

## 1. The issue — what was wrong

Under a traffic spike the API accepted every request. With half a CPU and a
5-connection pg pool, extra requests just queued: first in the event loop,
then waiting for a DB connection. Latency for **everyone** climbed until
clients and nginx timed out — nobody got served, and the server kept working
on requests whose clients had already given up. There was also no
`statement_timeout` (a runaway query pins a pool slot forever), no
`idle_in_transaction_session_timeout` (a crashed handler's transaction keeps
its row locks), and the request-size and request-time limits were implicit
Fastify defaults (`requestTimeout: 0` = never).

## 2. Why it happened — the root cause

`apps/api/src/app.ts` built Fastify with only `{ logger: true }` and nothing
bounded concurrency; `apps/api/src/db/pool.ts` set no server-side timeouts:

```ts
// before
const app = Fastify({ logger: true });
...
new Pool({ connectionString, max, idleTimeoutMillis, connectionTimeoutMillis });
```

The checkout path makes this worse: `payments/authorize.ts` and
`payments/capture.ts` hold a pooled connection (open transaction, and a
`FOR UPDATE` lock in capture) **across** the simulated acquirer call
(100–400 ms each). So each pay request occupies a DB connection for ~0.5 s,
and the pool — not the CPU — is the first thing to saturate.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | During a spike every checkout gets slow then times out; retries add more load | High |
| Merchants | Dashboard and API integrations time out together with checkout | Medium |
| FilsPay (ops) | No graceful degradation; pg pool waits surface as 500s after 5 s | High |
| Acquirer / partners | — | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/app.ts` | `installOverloadGuard`: an `onRequest` hook counts in-flight requests; above `MAX_IN_FLIGHT_REQUESTS` it answers **503 + `Retry-After: 1` immediately**. `/healthz` and `/readyz` are never shed. Fastify `bodyLimit` and `requestTimeout` from config |
| `apps/api/src/db/pool.ts` | `statement_timeout` and `idle_in_transaction_session_timeout` on every pooled connection |
| `apps/api/src/config.ts` | `MAX_IN_FLIGHT_REQUESTS` (100), `BODY_LIMIT_BYTES` (1 MiB), `HTTP_REQUEST_TIMEOUT_MS` (30 s), `PG_STATEMENT_TIMEOUT_MS` (30 s), `PG_IDLE_IN_TRANSACTION_TIMEOUT_MS` (60 s), `SHUTDOWN_TIMEOUT_MS` (25 s) |

The production values (pool 20, in-flight 64, statement timeout 15 s) are set
in `ops/docker-compose.prod.yml` and were chosen from the load test — see
`docs/ops/CAPACITY.md`.

No new dependency: the guard is ~25 lines and does one thing. A slot is freed
on the response's `finish` **or** `close` event (client hung up), exactly
once, so it cannot leak.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | In-repo in-flight cap + nginx rate/conn limits in front | Tiny, no deps, predictable, fast 503 | Cap is a number to tune | ✅ |
| 2 | `@fastify/under-pressure` (event-loop delay / heap based) | Reacts to real pressure | New dependency; event-loop lag does not see the real bottleneck here (pool waits are idle time, not CPU) | |
| 3 | Only nginx `limit_conn` | Zero app code | Does not protect the API from internal callers or a misconfigured proxy; nginx cannot send `Retry-After` per app state | |
| 4 | Bigger pool only | Raises the ceiling | Still melts down past the new ceiling | partly (pool 20 in prod) |

**Why we chose #1:** the cap matches the actual bottleneck (requests waiting
on DB connections) and fails fast and visibly.

## 6. Proof — tests

| Test | File | Before | After |
|---|---|---|---|
| `requests above MAX_IN_FLIGHT_REQUESTS get 503 + Retry-After at once…` | `apps/api/src/app.overload.new.test.ts` | ❌ third request queued forever (test hung until killed) | ✅ 503 in < 200 ms, slots freed after |
| `createPool applies statement_timeout and idle_in_transaction_session_timeout…` | same | ❌ `SHOW statement_timeout` = `0` | ✅ `1500ms` / `4s`; `pg_sleep(3)` cancelled |

```bash
cd apps/api && DATABASE_URL=... npx tsx --test src/app.overload.new.test.ts
```

Full API suite: 369 tests, 12 failures — exactly the known pre-existing ones
(11 refund `chk_refunds_reason_not_null`, 1 dispatcher backoff). Load-level
proof (503s instead of timeouts at 2× the knee): `docs/ops/CAPACITY.md`.

Existing tests changed: none.
