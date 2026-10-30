# SEC-RT-6 — A badly formatted id or date crashes the request with a 500

| | |
|---|---|
| **Severity** | Low (reliability, information) |
| **Area** | Security (error handling) |
| **Analysis ID** | — (red team, rounds 1 and 2: "auth" and "input" lenses) |
| **Decision** | D-016 |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** Sending a value Postgres can't read (a merchant id that isn't a UUID, a date like `2026-13-45`) gives `500 internal_error`.
- **Why:** The error handler only knew app errors, Fastify errors and DB-down errors; Postgres "this text isn't a valid uuid/date" fell through to the generic 500.
- **What it breaks:** Anyone can fill the error log on purpose (it hides real errors), a public login answers differently for malformed input, and to a tester it looks like the server crashed.

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/plugins/errorHandler.ts` | Postgres data-exception codes from client values (22P02, 22007, 22008, 22003) → `400 invalid_input` with a fixed message (no database text) |
| `apps/api/src/plugins/errorHandler.test.ts` | New tests |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Map Postgres parse errors to 400 in the one error handler | One place covers every route, now and later | Validation happens in the DB, not before | ✅ |
| 2 | Add JSON-schema validation (uuid/date formats) to every route | Rejects earlier | Dozens of routes to touch; a refactor | |
| 3 | Validate only the routes the red team hit | Small | The next route has the same bug | |
| 4 | Creative: per-route schemas generated from the TS types | Strongest | Tooling and time | |

## 6. Proof

| Test | Before | After |
|---|---|---|
| non-UUID merchant id on `POST /v1/auth/login` | ❌ 500 | ✅ 400 `invalid_input`, no DB text |
| malformed id in a public payment-link path | ✅ 4xx | ✅ 4xx |

Full API suite: 502 / 502. `tsc` clean.
