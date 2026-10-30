# BUG-070 — A suspended or closed merchant can still charge cards with its API key

| | |
|---|---|
| **Severity** | High |
| **Area** | Security · Money |
| **Commit** | see `git log --grep "BUG-070"` |
| **Status** | ✅ fixed |

**Present in the original code:** `apps/api/src/apiKeys/verify.ts:19` at 8b58b0f
(`SELECT id, merchant_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`).

## 1. The issue
Ops suspends a merchant (fraud, contract end): `merchants.status = 'suspended'` or `'closed'`.
Login and dashboard sessions stop (SEC-RT-2), but the merchant's server can keep calling
`POST /v1/transactions` (authorize), capture, void, payment links and webhooks with its API key.

## 2. Root cause
`verifyApiKey` (`apps/api/src/apiKeys/verify.ts`) only checked the key row (hash, revoked, revoke_after),
never `merchants.status`. `authorizeTransaction` only checks `onboarding_status = 'approved'`, which a
suspension does not change.

## 3. Who was affected
| Party | How | How bad |
|---|---|---|
| Cardholders | Can be charged by a shop FilsPay already shut down | High |
| FilsPay | Keeps processing (and owing payouts / chargebacks) for a suspended merchant | High |

## 4. Fix
`verifyApiKey` joins `merchants` and requires `m.status = 'active'`. One place covers
`requireApiKey` and `requireMerchantAuth`.

## 5. Options (ranked)
| Rank | Option | Chosen? |
|---|---|---|
| 1 | Status check in `verifyApiKey` (one query, PK join) | ✅ |
| 2 | Revoke all keys when a merchant is suspended | Lost on un-suspend; needs every suspend path to do it |
| 3 | Check status in each money route | Many places, easy to miss one |

## 6. Proof
| Test | File | Before | After |
|---|---|---|---|
| `a suspended merchant's API key no longer authenticates` / `closed` | `apps/api/src/apiKeys/verify.suspended.new.test.ts` | ❌ key context returned | ✅ null |

`cd apps/api && npx tsx --test src/apiKeys/verify.suspended.new.test.ts` — also `verify.new.test.ts`, `routes/transactions.test.ts` pass.
