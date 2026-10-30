# BUG-001 — Login works without the OTP

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Security |
| **Analysis ID** | A1 (see `docs/challenge/ANALYSIS.md`) |
| **Clue** | Handout: "Login works without entering the OTP code?"; `0012_sessions.sql` header |
| **Decision** | — |
| **Commit** | see `git log --grep "BUG-001"` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

Merchant login is password, then a 6-digit OTP. But the cookie set after the
password step was already a full login. Anyone with a merchant's password
could skip the OTP and use the dashboard and the API (read transactions,
issue API keys, create payment links, change webhooks).

Reproduce: `POST /v1/auth/login` with a correct password, take the `fp_sid`
cookie, call `GET /v1/auth/me` without calling `/v1/auth/otp/verify`. It
returned 200 with the merchant's data.

## 2. Why it happened — the root cause

`apps/api/src/auth/sessions.ts` `lookupSession` (the one function every
merchant-session route uses, via `requireSession` and `requireMerchantAuth`)
read from the `live_sessions` view and filtered only by the token:

```ts
// before
`SELECT s.id AS session_id, s.merchant_user_id, mu.merchant_id, mu.role
   FROM live_sessions s
   JOIN merchant_users mu ON mu.id = s.merchant_user_id
  WHERE s.token_hash = $1`
```

The view (`db/migrations/0058_live_sessions.sql`) only removes revoked and
expired rows. It never checks `authenticated = true`. A pending session row
(created at the password step with `authenticated = false`) is not revoked
and not expired, so it passed.

`0012_sessions.sql` says every auth query **must** include
`authenticated = true`. The admin plane (`adminAuth/sessions.ts
lookupAdminSession`) does include it, and was checked: a pending admin cookie
is rejected (existing test "a pending (pre-OTP) admin cookie authenticates
nothing"). Only the merchant side lost it when it moved to the view.

False claims that hid it: `routes/apiKeys.ts` comment "pending sessions can't
reach this, requireSession checks authenticated"; `auth/sessions.test.ts`
"theres no test for a NOT promoted session — MK: covered in
routes/auth.test.ts" (that file does not exist).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Card data and payments visible to an attacker who only has a password | High |
| Merchants | Second factor did nothing; a leaked or guessed password = full account takeover (API keys, payment links, webhooks) | Critical |
| FilsPay (finance / ops) | Security claim "pending session grants nothing" (ARCHITECTURE §Security) was false | High |
| Acquirer / card scheme / partners | Fraud via merchant accounts | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/auth/sessions.ts` `lookupSession` | add `AND s.authenticated = true` |

```ts
// after
  WHERE s.token_hash = $1
    AND s.authenticated = true
```

One predicate in the one place that decides "is this a logged-in merchant".
It restores the rule from 0012. No other route re-implements the check, so
every merchant-session route is covered by this single line.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Add `authenticated = true` in `lookupSession` | One line, explicit, same shape as the admin lookup | View name still suggests "logged in" | ✅ |
| 2 | New migration redefining `live_sessions` with `authenticated = true` | Nobody can reuse the view wrongly | Changes the meaning of a shared view; still want the explicit predicate | |
| 3 | Check `authenticated` in each middleware | — | Duplicates the rule; easy to miss one | |

**Why we chose #1:** smallest change, matches the 0012 rule and the admin plane exactly.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-001: a pending ... cookie authenticates nothing` | `apps/api/src/routes/auth.new.test.ts` | ❌ `/v1/auth/me` returned 200 with merchant data | ✅ 401 on `/me`, `/v1/transactions`, API-key issue |
| `BUG-001: the same cookie works once the OTP is verified` | same | ✅ | ✅ |

```bash
cd apps/api && npx tsx --test src/routes/auth.new.test.ts
```

Existing tests changed: none.
