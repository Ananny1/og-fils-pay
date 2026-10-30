# BUG-012 — API key rotation leaves the old key working

| | |
|---|---|
| **Severity** | High |
| **Area** | Security |
| **Analysis ID** | A11 |
| **Clue** | Handout: "key rotation flow doesn't do what you'd expect"; FH's note in `0037_api_keys_admin_rotation.sql`; YA's note in `admin.test.ts` |
| **Decision** | — |
| **Commit** | see `git log --grep "BUG-012"` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

When a merchant's API key leaks, ops uses **Rotate API key** in the admin
console. A new key is issued — but the old (leaked) key kept working forever.
Whoever had it could still authorize card payments, capture, void and read
the merchant's transactions.

Reproduce: `POST /v1/admin/merchants/:id/api-keys/:keyId/rotate`, then call
`GET /v1/transactions` with the old key → 200.

## 2. Why it happened — the root cause

`apps/api/src/admin/apiKeys.ts rotateApiKeyAsAdmin` locked the old row,
issued a new key pointing back at it (`rotated_from_key_id`) and wrote the
audit row — but never revoked the old key. 0037 says "one transaction revokes
the old key with reason 'rotated' and issues the replacement", and
`IssueApiKeyInput.rotatedFromKeyId` says "that key is revoked in the same
transaction". Neither was true.

`0056_api_keys_revoke_after.sql` added `revoke_after` "revoked by a sweep job"
— there is no sweep job, nothing sets the column, and
`apps/api/src/apiKeys/verify.ts` never checked it:

```ts
// before
SELECT id, merchant_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL
```

The "24h grace period (see ADMIN.md)" claim is false: ADMIN.md says nothing
about a grace period, and YA notes "there was never a grace period in the
design. rotation = revoke". The existing test `admin.test.ts` asserted the bug
("the previous key stays active").

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | A leaked key could keep charging/capturing | High |
| Merchants | No way to cut off a leaked key through ops | High |
| FilsPay (finance / ops) | Incident response step silently did nothing | High |
| Acquirer / card scheme / partners | Fraudulent authorisations | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/admin/apiKeys.ts` | in the rotation transaction: `UPDATE api_keys SET revoked_at = now(), revoked_reason = 'rotated'` on the old key |
| `apps/api/src/apiKeys/verify.ts` | also require `revoke_after IS NULL OR revoke_after > now()` |
| `apps/api/src/routes/admin.test.ts` | rotation test now asserts the old key gets 401 and is revoked with reason `rotated` |

```ts
// after — verify.ts
WHERE key_hash = $1
  AND revoked_at IS NULL
  AND (revoke_after IS NULL OR revoke_after > now())
```

The revoke happens in the same transaction as the new key and the audit row,
so either all three happen or none. The `revoke_after` check makes the 0056
column honest: if anyone schedules a revocation, it takes effect on time
without a sweep job.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Revoke immediately at rotation + honour `revoke_after` in verify | Matches 0037 design; leaked key dies now | Merchant must deploy the new key first (same as any revoke) | ✅ |
| 2 | Set `revoke_after = now() + 24h` and check it | Gives an overlap window | A leaked key works for another day; design never had a grace period | |
| 3 | Add a sweep job for `revoke_after` | — | More moving parts; still late | |

**Why we chose #1:** rotation exists for leaked keys; the design says rotation = revoke.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-012: after an admin rotation the old key no longer authenticates` | `apps/api/src/apiKeys/verify.new.test.ts` | ❌ old key still verified | ✅ null; new key works; row revoked `rotated` |
| `BUG-012: a key past its scheduled revoke_after no longer authenticates` | same | ❌ still verified | ✅ |
| `API key rotation ... revokes the previous key and audits it` | `apps/api/src/routes/admin.test.ts` | asserted the bug | ✅ |

```bash
cd apps/api && npx tsx --test src/apiKeys/verify.new.test.ts src/routes/admin.test.ts
```

Existing tests changed: `admin.test.ts` rotation test — it asserted the old
key stays active (the bug). Now it asserts 401 and `revoked_reason = 'rotated'`.
