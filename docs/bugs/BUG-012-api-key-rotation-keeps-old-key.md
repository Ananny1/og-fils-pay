# BUG-012 — Rotating an API key leaves the old key working

| | |
|---|---|
| **Severity** | High |
| **Area** | Security (credentials) |
| **Analysis ID** | A11 |
| **Clue** | "key rotation flow doesn't do what you'd expect"; FH's note in `0037_api_keys_admin_rotation.sql` |
| **Owner** | Ebrahim (sprint stream S1) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** When staff rotate a shop's API key (usually because it leaked), the new key is made but the **old key keeps working forever**.
- **Why:** `rotateApiKeyAsAdmin` only inserts the new key. Nothing sets `revoked_at` on the old one.
- **What it breaks:** A leaked key stays usable after the "fix". Whoever has it can still list transactions, create payment links, capture and void.

## 1. The issue

```
POST /v1/admin/merchants/<m>/api-keys/<old>/rotate   -> 201 new key
GET  /v1/transactions   Bearer <old key>             -> 200   (expected 401)
api_keys old row: revoked_at = NULL, revoked_reason = NULL
```

## 2. Why it happened

`apps/api/src/admin/apiKeys.ts` `rotateApiKeyAsAdmin` locks the old row, checks it isn't revoked,
issues the new key and writes the audit row, but never revokes the old row.

Every design source says rotation **is** revoke:

- `0037_api_keys_admin_rotation.sql`: "one transaction revokes the old key with reason 'rotated' and issues the replacement".
- `apiKeys/issue.ts`: "the admin rotation path revokes the old key … in the same transaction".
- `routes/adminMerchants.ts`: "Atomic rotate: revoke + reissue + audit in one transaction."

False claims that hid it (traps):

| Where | Claim | Truth |
|---|---|---|
| `db/migrations/0037_api_keys_admin_rotation.sql` (end) | AM: "that's the 24h grace period (see ADMIN.md)" | `docs/ADMIN.md` has no grace period; nothing ever revokes the key, not even after 24h |
| `apps/api/src/apiKeys/issue.ts` above `revokeApiKey` | am: "it does [call revoke], around line 47" | `admin/apiKeys.ts` never revoked anything |
| `apps/api/src/routes/admin.test.ts` rotation test | "previous key stays active — grace period … intended (am, 2026-05)" | YA's reply right under it: "there was never a grace period in the design" |

`0056_api_keys_revoke_after.sql` (a "scheduled revocation" column) is a v2 migration number
reserved by ADR-0005; no code reads or writes `revoke_after`, so it is not a grace period either.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | A leaked key can't be killed by rotation | High: attacker keeps API access |
| FilsPay | Support tells the shop "rotated, you're safe" when it isn't | High |
| Customers | Attacker with the key can void/capture their payments | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/admin/apiKeys.ts` | In the same transaction, `UPDATE api_keys SET revoked_at = now(), revoked_reason = 'rotated'` on the old key before issuing the new one |
| `apps/api/src/routes/admin.test.ts` | The rotation test asserted the bug (old key 200, `revoked_at` NULL). Now it expects 401 and `revoked_reason = 'rotated'` |

`verifyApiKey` already rejects rows with `revoked_at` set, so no change is needed there. The audit
failure test still proves the whole rotation (revoke included) rolls back together.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Revoke the old key in the rotation transaction (`revoked_reason = 'rotated'`) | Matches 0037, issue.ts and route docs; one statement; atomic | Shop must switch to the new key at once | ✅ |
| 2 | Call `revokeApiKey()` from `issue.ts` | Reuses a helper | It takes a `Pool`, not the open transaction, so it isn't atomic with the insert and audit | |
| 3 | Real grace period: set `revoke_after = now() + 24h` and check it in `verifyApiKey` (creative) | Zero-downtime switch for the shop | No doc asks for it; 0056 is a reserved v2 number (ADR-0005); a leaked key works for another day | |

**Why #1:** the design says rotation = revoke, and a rotation is usually done because a key leaked.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `API key rotation issues a new key atomically, revokes the previous key and audits it` | `apps/api/src/routes/admin.test.ts` | ❌ `200 !== 401` (old key still works) | ✅ passes |
| `a forced audit-write failure rolls back an API key rotation entirely` | same | ✅ | ✅ |
| Whole file | same | | ✅ 41/41 |

```bash
npx tsx --test apps/api/src/routes/admin.test.ts
```

Existing tests changed: the rotation test above, because it encoded the bug (the "intended grace period" claim was false).
