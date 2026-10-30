# SEC-RT-2: A suspended or closed merchant stays logged in

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Security (session management) |
| **Analysis ID** | Security sprint, red-team finding SEC-RT-2 (lens: session) |
| **Clue** | Login requires `m.status = 'active'`, but `lookupSession` never looks at `merchants.status` |
| **Decision** | D-016 (security sprint) |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** Suspending or closing a merchant does not log out its users. Their open sessions keep full dashboard access.
- **Why:** The status check is only done at login. `lookupSession`, used on every merchant request, joins `merchant_users` but not `merchants`, so it never sees the status.
- **What it breaks:** A merchant shut down for fraud or a contract end can keep using the dashboard (payment links, refunds, reports) for up to 60 min idle / 12 h total.

## 1. The issue

To reproduce: log in as a merchant user, set `merchants.status = 'suspended'` (or `'closed'`),
then call `GET /v1/auth/me` with the same cookie. Before the fix it answered 200, while a new login
for the same user was refused. The admin plane already re-checks `au.status = 'active'` on every
request, so the two planes behaved differently.

## 2. Why it happened

`apps/api/src/auth/sessions.ts` `lookupSession` checks `token_hash`, `authenticated = true`, the
idle window and (via `live_sessions`) revoked/expired. `merchants.status` (CHECK `active`,
`suspended`, `closed`, migration 0002) was only read in `routes/auth.ts` at login.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| FilsPay staff / ops | Suspending a merchant does not take effect until its sessions expire | Medium |
| Customers | A suspended merchant can still create links and issue refunds | Medium |
| Merchants | None directly | Low |

Limit today: nothing in the app sets a merchant to `suspended`/`closed` yet (done out-of-band),
so the control was simply ineffective rather than bypassed.

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/auth/sessions.ts` | `lookupSession` joins `merchants` and requires `m.status = 'active'`, same as login |
| `apps/api/src/auth/sessions.test.ts` | Two new tests (suspended, closed) |

```sql
JOIN merchants m ON m.id = mu.merchant_id
...
AND m.status = 'active'
```

The join is on the `merchants` primary key, so no new index and no extra write. Works with many
instances since the status lives in Postgres. `merchant_users` has no status column, so there is
nothing else to check at user level.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Re-check `m.status = 'active'` in `lookupSession` | One join, effective on the next request, covers any way the status is changed | One PK join per request (cheap) | ✅ |
| 2 | Revoke all sessions when a merchant is suspended | Clear audit trail | No in-app suspend route yet; an out-of-band `UPDATE` would skip it | Later, as an extra |
| 3 | DB trigger on `merchants.status` that revokes sessions | Covers raw SQL | Hidden logic, new migration; option 1 already covers it | |
| 4 | Shorter session TTL | No code | Only shrinks the window | |

## 6. Proof: tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `lookupSession returns null once the merchant is suspended` | `apps/api/src/auth/sessions.test.ts` | ❌ session resolved | ✅ `null` |
| `lookupSession returns null once the merchant is closed` | same | ❌ | ✅ |
| existing session tests | `auth/sessions.test.ts`, `routes/auth.idleTimeout.test.ts`, `routes/auth.sessionRotation.test.ts` | ✅ | ✅ (7 + 9 + 4) |
| `tsc --noEmit -p apps/api` | | ✅ | ✅ |
