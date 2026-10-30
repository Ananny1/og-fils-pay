# SEC-2: An unused session stays logged in for 12 h (shops) or 8 h (staff)

| | |
|---|---|
| **Severity** | Medium (High on the admin console) |
| **Area** | Security (session management) |
| **Analysis ID** | Security sprint, item SEC-2 |
| **Clue** | Hardening review: sessions only have a fixed lifetime (`SESSION_TTL_HOURS`, `ADMIN_SESSION_TTL_HOURS`) |
| **Decision** | D-016 (security sprint) |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** If you log in and walk away, your session keeps working for the whole 12 h (shop) or 8 h (staff), even though nobody is using it.
- **Why:** `lookupSession` and `lookupAdminSession` only check `expires_at`, which is fixed at login. There was no "last used" time, so they had no way to see that a session had gone idle.
- **What it breaks:** Someone who finds an unlocked PC, or steals a cookie, gets hours of access. On the admin console that means support or finance powers over every merchant.

## 1. The issue

To reproduce: log in, make no requests for 2 hours, then call `GET /v1/auth/me` (or
`/v1/admin/auth/me`). Before the fix it answered 200. Logout was already fine: it sets
`revoked_at` on the row, and the new test confirms this.

## 2. Why it happened

`apps/api/src/auth/sessions.ts` `lookupSession` (via the `live_sessions` view) and
`apps/api/src/adminAuth/sessions.ts` `lookupAdminSession` accept any row where
`authenticated = true AND revoked_at IS NULL AND expires_at > now()`. `expires_at` is set once in
`promoteSession` / `promoteAdminSession` (now + 12 h / 8 h). Neither table had a column for the
last time the session was used.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | A dashboard left open on a shared or stolen device stays logged in for up to 12 h | Medium |
| FilsPay staff / ops | An admin session left open stays usable for up to 8 h | High |
| Customers | Indirectly, through refunds or data reached via a hijacked session | Low |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0075_session_last_seen.sql` | `last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()` on `sessions` and `admin_sessions`; `live_sessions` view now also returns it |
| `apps/api/src/config.ts` | `sessionIdleMinutes` (`SESSION_IDLE_MINUTES`, 60) and `adminSessionIdleMinutes` (`ADMIN_SESSION_IDLE_MINUTES`, 30), read with `parseIntEnv` |
| `apps/api/src/auth/sessions.ts` | `lookupSession(pool, token, idleMinutes)` also requires `last_seen_at > now() - idle`. It touches `last_seen_at` only when the stored value is more than a minute old. `promoteSession` sets `last_seen_at = now()` |
| `apps/api/src/adminAuth/sessions.ts` | Same for `lookupAdminSession` / `promoteAdminSession` |
| `apps/api/src/auth/middleware.ts`, `auth/requireMerchantAuth.ts`, `adminAuth/middleware.ts` | Pass the configured idle window |
| `apps/api/src/auth/sessions.test.ts` | The existing calls now pass the new `idleMinutes` argument (60) |

```sql
-- in the lookup
AND s.last_seen_at > now() - make_interval(mins => $2)
-- touch, run only when the lookup said last_seen_at is over a minute old
UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '1 minute'
```

This works across several API instances because the state lives in Postgres. The extra write
happens at most once a minute per session, not on every request, and the predicate is repeated in
the `UPDATE` so parallel requests do not all write. Lookups still use `token_hash` (UNIQUE) and the
touch uses `id` (PK), so no new index is needed. The fixed `expires_at` cap is kept: a session
that stays active still ends after 12 h / 8 h. Impersonation grants keep their own 15-minute TTL
and are not changed.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | `last_seen_at` column, checked in the lookup, touch throttled to once a minute | Enforced on the server, works with many instances, about 1 write per minute per active user | One migration; idle time is accurate to about 1 minute | ✅ |
| 2 | Sliding `expires_at` (push it forward on every request) | No new column | Loses the absolute 12 h / 8 h cap, and writes on every request unless throttled | |
| 3 | Idle timer in the browser only (frontend logs out) | No backend change | A stolen cookie still works; the browser timer is easy to bypass | |
| 4 | In-memory "last seen" map in the API | No DB write | Breaks with several instances, unbounded memory, lost on restart | |

**Why we chose #1:** it is the smallest change that the server enforces, it keeps the existing hard cap, and it follows the scalability rule (shared state in Postgres, throttled writes).

## 6. Proof: tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `idle windows default to 60 min (merchant) and 30 min (admin)` | `apps/api/src/routes/auth.idleTimeout.test.ts` | ❌ config fields missing | ✅ |
| `merchant/admin: a session idle longer than the window is dead (401)` | same | ❌ no `last_seen_at`, session still 200 | ✅ 401 |
| `merchant/admin: a session used inside the window stays alive and is touched` | same | ❌ | ✅ 200, `last_seen_at` moved forward |
| `merchant/admin: the touch is throttled (no write when last seen under a minute ago)` | same | ❌ | ✅ row `xmin` unchanged after 3 requests |
| `merchant/admin: logout revokes the session server-side` | same | ✅ (already correct) | ✅ |
| existing session lookup and rotation tests | `auth/sessions.test.ts`, `routes/auth.sessionRotation.test.ts`, `config.test.ts` | ✅ | ✅ (23/23 with the new file) |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -T -e DATABASE_URL=<db> \
  -v "$PWD/apps/api/src:/app/apps/api/src" ... api npx tsx --test apps/api/src/routes/auth.idleTimeout.test.ts
```

Existing tests changed: `auth/sessions.test.ts` passes the new `idleMinutes` argument. The test
logic is unchanged. In the full API run (406 tests), the only failures are 12 tests in
`payments/processRefund.test.ts`, `refunds/initiateMerchantRefund.test.ts` (refund reason
constraint `chk_refunds_reason_not_null`) and `webhooks/dispatcher.test.ts`. None of that code
touches sessions.
