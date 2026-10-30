# SEC-3 — Security headers, no internal details in errors, request size and time limits

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Security (hardening: confidentiality + availability) |
| **Analysis ID** | — (security sprint, D-016) |
| **Clue** | Judges' likely tests: "error messages that leak internals", "security headers", floods / slow clients |
| **Decision** | D-016 |
| **Commit** | see `git log --grep SEC-3` |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** The API sent no security headers, a 5xx reply could carry internal hosts, paths and upstream bodies, a bad or oversized request answered 500, and a client that opens a connection and stalls was never cut off.
- **Why:** `buildApp` used `Fastify({ logger: true })` with no limits or timeouts and no header hook; `plugins/errorHandler.ts` sent every `AppError` message as is and turned Fastify's own 4xx errors (bad JSON, body too large) into 500.
- **What it breaks:** An attacker learns internal addresses from error replies, can frame or MIME-sniff API replies, can tie up sockets with slow requests (slow-loris), and the 500s for client mistakes hide real failures in monitoring.

## 1. The issue

- `GET /v1/auth/me` returned no `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`,
  `Referrer-Policy`, `Cache-Control` or (in production) `Strict-Transport-Security`.
- A down settlement service answered `502 {"error":"settlement_unreachable","message":"settlement internal
  call to /internal/... failed: ECONNREFUSED 10.x.x.x:8091"}` to the browser.
- `POST /v1/auth/login` with `{not json` or a 1.1 MB body answered **500 internal_error**.
- `printf 'GET /healthz HTTP/1.1\r\nHost: x\r\n' | nc api 3000` (headers never finished) kept the socket
  open indefinitely: Fastify's `connectionTimeout` default is 0 (off).

## 2. Why it happened

```ts
// apps/api/src/app.ts (before)
const app = Fastify({ logger: true });           // no bodyLimit / timeouts, no header hook

// apps/api/src/plugins/errorHandler.ts (before)
if (err instanceof AppError) {
  reply.code(err.statusCode).send({ error: err.code, message: err.message }); // 5xx message too
  return;
}
...
request.log.error(...); reply.code(500)...       // FST_ERR_CTP_INVALID_JSON_BODY (400) and
                                                 // FST_ERR_CTP_BODY_TOO_LARGE (413) end up here
```

`admin/settlementClient.ts` builds its 5xx `AppError` messages from the target path, the network error
and up to 500 bytes of the upstream body. Those are useful in logs, not for clients.

Unexpected errors (pg errors etc.) were already a generic `{"error":"internal_error"}` (now covered by a
test). Session cookies were already `HttpOnly`, `SameSite=Lax` and `Secure` when `NODE_ENV=production`
(`cookieSecure` defaults to production); verified, no change needed (test added).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Session-bound pages (balances, CSV exports) could be cached by a shared proxy or browser; API replies could be framed | Medium |
| FilsPay staff | Admin console error replies showed internal hosts and paths | Medium |
| FilsPay (ops) | Slow or huge requests hold sockets and memory; client errors show up as 500s in monitoring | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/plugins/securityHeaders.ts` (new) | `onSend` hook: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `CSP: default-src 'none'; frame-ancestors 'none'`, no `X-Powered-By`; HSTS only in production; `Cache-Control: no-store` on every `/v1/` reply. No helmet dependency. |
| `apps/api/src/plugins/errorHandler.ts` | 5xx `AppError`: logged with the request id; in production only `{ error: code }` is sent. Fastify's own `FST_*` 4xx errors keep their status (`payload_too_large` / `bad_request`) instead of 500. |
| `apps/api/src/app.ts` | Registers the header plugin; passes `bodyLimit`, `connectionTimeout`, `requestTimeout`, `keepAliveTimeout`, `http.headersTimeout` from config. |
| `apps/api/src/config.ts` | `HTTP_BODY_LIMIT_BYTES` (1 MiB), `ADJUSTMENT_IMPORT_BODY_LIMIT_BYTES` (5 MiB), `HTTP_CONNECTION_TIMEOUT_MS` (60 s idle), `HTTP_HEADERS_TIMEOUT_MS` (20 s), `HTTP_REQUEST_TIMEOUT_MS` (120 s), `HTTP_KEEP_ALIVE_TIMEOUT_MS` (72 s). |
| `apps/api/src/routes/adminAdjustmentImport.ts` | The CSV import (CSV pasted as JSON) gets its own 5 MiB `bodyLimit`. |
| `apps/api/src/app.security.test.ts` (new) | Tests below. |

Limits chosen so nothing legitimate breaks: the idle timeout (60 s) is above the slowest handler (the
30 s internal settlement call); the request timeout (120 s) lets an 8 MB KYC upload finish on a slow
phone link; KYC is multipart and keeps its own `kycMaxFileSizeBytes` cap. All are per-instance socket
settings, so they work the same with several API instances behind nginx.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Small `onSend` hook + error-handler rules + Fastify's built-in limits, all from config | No new dependency; one place each; covers errors and 404s too | We maintain six header lines ourselves | ✅ |
| 2 | Add `@fastify/helmet` | Well-known, many headers | New dependency; its defaults target HTML sites (CSP etc. need tuning for a JSON API) | |
| 3 | Set headers and limits only in nginx | Also protects other services | Lost when the API is reached directly (port 3000 is published); error bodies still leak | |
| 4 | Strip messages from every error, 4xx too | Simplest rule | Merchants lose the useful 4xx explanations they integrate against | |

**Why we chose #1:** it fixes all four gaps in the API itself, with no dependency and no change to the
4xx contract merchants rely on. nginx limits (option 3) are a good extra layer, owned by the load stream.

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| every response carries the security headers | `apps/api/src/app.security.test.ts` | ❌ no headers | ✅ |
| /v1 responses are never cached; HSTS only in production | same | ❌ | ✅ |
| production 500: no SQL text or constraint name reaches the client | same | ✅ (already generic) | ✅ |
| production 5xx AppError: keeps the code, drops the internal message | same | ❌ ECONNREFUSED + IP in body | ✅ |
| malformed JSON is a 400, not a 500 | same | ❌ 500 | ✅ |
| a body over the 1 MiB limit is a 413, not a 500 | same | ❌ 500 | ✅ |
| the CSV import route accepts a body above 1 MiB | same | ❌ 500 (too large) | ✅ 401 (body accepted, auth checked) |
| server timeouts are set | same | ❌ request 300 s, no idle timeout | ✅ |
| an idle half-sent request is dropped after the connection timeout | same | ❌ socket kept open | ✅ closed |
| session cookie is HttpOnly, Secure and SameSite in production | same | ✅ | ✅ |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -T -e DATABASE_URL=<db> \
  -v "$PWD/apps/api/src:/app/apps/api/src" ... api npx tsx --test apps/api/src/app.security.test.ts
```

API suite: 407 tests, 395 pass, 12 fail = the T1 baseline (refund + webhook). `tsc` clean.
Existing tests changed: none.
