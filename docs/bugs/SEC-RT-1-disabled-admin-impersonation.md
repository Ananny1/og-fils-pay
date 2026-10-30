# SEC-RT-1: A disabled admin keeps their "view as merchant" grant

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Security (session management, admin impersonation) |
| **Analysis ID** | Security sprint, red-team finding SEC-RT-1 (lens: session) |
| **Clue** | `admin/impersonation.ts` comment "revoked_at gets set by the admin-disable trigger, so it's covered" (false: no such trigger exists) |
| **Decision** | D-016 (security sprint) |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** When a staff account is disabled, its admin session dies at once, but any open "view as merchant" grant keeps working until it expires.
- **Why:** `lookupImpersonationGrant` joins `admin_users` but never checks `au.status = 'active'`. The comment says a trigger revokes the grants on disable. There is no such trigger in `db/migrations`.
- **What it breaks:** A fired or suspended support operator who still has the `fp_impersonation` cookie can keep reading that merchant's dashboard data for the rest of the grant TTL.

## 1. The issue

To reproduce: start an impersonation grant as an admin, set `admin_users.status = 'disabled'`,
then call `GET /v1/transactions` with the `fp_impersonation` cookie. Before the fix it answered 200.
The admin's own session (`lookupAdminSession`) already returned nothing for the same admin.

## 2. Why it happened

`apps/api/src/admin/impersonation.ts` `lookupImpersonationGrant` resolved a grant on
`token_hash + revoked_at IS NULL + ended_at IS NULL + expires_at > now()` only. The comment that
said a disable trigger sets `revoked_at` was false (trap). `routes/admin.ts` even admitted it
("disabled admins' grants keep working until they expire", FP-238).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Their data stays readable by a staff member who was removed | Medium |
| FilsPay staff / ops | Disabling an account does not fully cut access | Medium |
| Customers | Their payment details on that merchant's dashboard stay visible | Low |

Limits: the grant is read-only (BUG-010) and short-lived, and there is no in-app disable route yet.

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/admin/impersonation.ts` | `lookupImpersonationGrant` also requires `au.status = 'active'` (mirrors `lookupAdminSession`); false trigger comment removed |
| `apps/api/src/routes/admin.ts` | Stale FP-238 comment replaced with what now happens |
| `apps/api/src/routes/impersonation.readOnly.test.ts` | New test; `grantFor` also returns `adminUserId` |

The lookup still goes through `token_hash` (UNIQUE) and the join is on the `admin_users` primary
key, so no new index or write is needed. Works the same with several API instances.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Re-check `au.status = 'active'` in the grant lookup | One line, takes effect on the next request, no matter how the admin is disabled (UI, SQL, script) | None real | ✅ |
| 2 | Revoke all open grants (`revoked_at`) when an admin is disabled | Leaves an audit trail | No in-app disable route exists yet; an out-of-band `UPDATE` would skip it | Later, as an extra |
| 3 | DB trigger on `admin_users.status` that revokes grants | Covers SQL updates | Hidden logic in the DB, new migration; the lookup check already covers it | |
| 4 | Shorten the grant TTL | No code change | Only shrinks the window, does not close it | |

## 6. Proof: tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `a disabled admin's impersonation grant no longer resolves or reads merchant data` | `apps/api/src/routes/impersonation.readOnly.test.ts` | ❌ grant resolved | ✅ `null` and 401 |
| existing BUG-010 read-only tests (6) | same | ✅ | ✅ (7/7) |
| `tsc --noEmit -p apps/api` | | ✅ | ✅ |
