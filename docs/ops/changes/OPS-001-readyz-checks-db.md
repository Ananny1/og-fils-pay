# OPS-001 — `/readyz` says "ready" forever, even with the database down

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Deploy / Availability |
| **Analysis ID** | D7 (see `docs/challenge/ANALYSIS.md`) |
| **Clue** | `docs/RUNBOOK.md` ("does not re-check afterwards"), comment in `routes/health.ts`, `health.test.ts` "never re-checks" |
| **Decision** | — |
| **Commit** | see `git log --grep OPS-001` |
| **Status** | ✅ done |

## 1. The issue — what was wrong

`GET /readyz` is meant to tell a load balancer, Docker healthcheck or
operator "this API can serve traffic". It only reported whether the API
reached Postgres **once, at boot**. Stop Postgres after the API has started
and `/readyz` still answers `200 {"status":"ready"}` while every real request
fails with 500.

Reproduce: start the API, `docker stop` Postgres, `curl /readyz` → `200 ready`.

## 2. Why it happened — the root cause

`apps/api/src/routes/health.ts` read a module flag that `index.ts` sets once
after its boot `SELECT 1` and never clears:

```ts
// before — routes/health.ts
app.get("/readyz", async (_req, reply) => {
  if (!isReady()) {            // health/state.ts: a one-way latch
    reply.code(503);
    return { status: "not_ready" };
  }
  return { status: "ready" };
});
```

The comment called this "deliberate, documented base platform behavior" and
blamed incident 2026-05-14 ("readyz flapping took the LB out"). That claim is
not supported: the 2026-05 postmortem never mentions readyz, and a readiness
check that cannot fail is not a fix for flapping — it just hides outages.
`health.test.ts` encoded the bug ("never re-checks").

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Checkout kept being routed to an API that could not reach the DB → 500s instead of a clean "try again" | Medium |
| Merchants | Same; dashboards fail with no signal to ops | Medium |
| FilsPay (finance / ops) | Healthchecks and `depends_on: service_healthy` stay green during a DB outage, so alerts never fire | Medium |
| Acquirer / partners | none directly | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/health.ts` | `/readyz` = boot latch passed **and** a live `SELECT 1` succeeds within 2 s; otherwise `503 {"status":"not_ready","reason":...}` |
| `apps/api/src/routes/health.test.ts` | Test that asserted "never re-checks" changed to assert it does re-check |
| `apps/api/src/routes/health.new.test.ts` | New: DB down after boot → 503; DB up → 200 |

```ts
// after
if (!isReady()) { reply.code(503); return { status: "not_ready", reason: "booting" }; }
try {
  await Promise.race([app.db.query("SELECT 1"), timeout(READYZ_DB_TIMEOUT_MS)]);
} catch {
  reply.code(503);
  return { status: "not_ready", reason: "database_unreachable" };
}
return { status: "ready" };
```

Smallest change: the latch is kept (so "not ready before boot" still holds);
one bounded probe is added. `/healthz` (liveness) still never touches the
DB, so a DB outage never makes Docker think the *process* is dead. The probe
is time-bounded (2 s) so it cannot hang a prober, which is the real cure for
"flapping" worries; flapping itself is handled by the prober's
`retries`/`interval` (compose: 3 × 10 s).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Live `SELECT 1` per probe, time-bounded | Always true; tiny; no background state | One DB round-trip per probe (every 10 s — negligible) | ✅ |
| 2 | Background timer re-checks every N s, readyz reads the cached result | Probe never waits on DB | Stale by up to N s; another timer to stop on shutdown | |
| 3 | Mark not-ready from the pool `error` event | No extra queries | Misses a hung DB (no error is emitted); never recovers without more code | |

**Why we chose #1:** simplest code that is always correct; cost is one trivial query per probe.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `GET /readyz is 503 when the database is unreachable, even after a successful boot` | `apps/api/src/routes/health.new.test.ts` | ❌ `200 !== 503` | ✅ |
| `GET /readyz is 200 when booted and the database answers` | same | ✅ | ✅ |
| `GET /readyz re-checks the live database after boot…` | `apps/api/src/routes/health.test.ts` | (asserted the bug) | ✅ |

```bash
cd apps/api && DATABASE_URL=... npx tsx --test src/routes/health.new.test.ts src/routes/health.test.ts
```

Existing tests changed: `health.test.ts` — the third test asserted the bug
("the flag is a one-way latch… nothing re-verifies DB liveness"); it now
asserts the opposite. Also checked live in the prod compose stack:
`docs/ops/AVAILABILITY.md` ("Database restart").
