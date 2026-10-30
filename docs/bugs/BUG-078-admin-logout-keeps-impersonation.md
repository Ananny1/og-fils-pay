# BUG-078 — Staff logout leaves the "view as merchant" grant working

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Security (admin sessions, impersonation) |
| **Commit** | see `git log --grep "BUG-078"` |
| **Status** | ✅ fixed |

**Present in the original code:** `apps/api/src/routes/adminAuth.ts:212` at 8b58b0f (logout only
`revokeAdminSession`); `apps/api/src/admin/impersonation.ts:120-123` at 8b58b0f (a grant resolves on
its own token, never on the admin's session).

## 1. The issue
An operator opens "view as merchant", then clicks Log out in the staff console. The admin session
ends, but the `fp_impersonation` cookie still opens that merchant's dashboard data (transactions,
reports, settlement) until the grant's TTL ends. On a shared PC the next person sees it.

## 2. Root cause
`POST /v1/admin/auth/logout` revoked only the `admin_sessions` row and cleared only `fp_admin_sid`.
`lookupImpersonationGrant` checks the grant row (`revoked_at`, `ended_at`, `expires_at`, admin
active), not whether its admin is still logged in, so the grant survived.

## 3. Who was affected
| Party | How | How bad |
|---|---|---|
| Merchants | Their data stays readable after the operator logged out | Medium |
| FilsPay | Logout does not end staff access as staff expect | Medium |

## 4. Fix
Logout also ends that admin's open grants (`UPDATE admin_impersonation_grants SET ended_at = now()
WHERE admin_user_id = $1 AND ended_at IS NULL ...`, indexed on `admin_user_id`) and clears the
impersonation cookie.

## 5. Options (ranked)
| Rank | Option | Chosen? |
|---|---|---|
| 1 | End the admin's open grants at logout + clear cookie | ✅ |
| 2 | Store the admin session id on the grant and require it live at lookup | Also covers idle/expiry, but needs a migration and lookup change |
| 3 | Only clear the cookie | A copied cookie still works |

## 6. Proof
| Test | File | Before fix | After fix |
|---|---|---|---|
| `admin logout ends that admin's open impersonation grants` | `apps/api/src/routes/adminLogoutEndsImpersonation.new.test.ts` | ❌ `200 !== 401` | ✅ pass |

Also `adminImpersonation.new.test.ts`, `adminAuth.new.test.ts`, `impersonation.readOnly.test.ts`: 13 pass, 0 fail.
