# BUG-001 — Login works without the OTP

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Security (authentication) |
| **Analysis ID** | A1 |
| **Clue** | S3 group chat: "Login works without entering the OTP code?" · S4: "the OTP implementation changed at some point. is it still safe?" |
| **Evidence** | S3, S4 |
| **Decision** | D-003 |
| **Owner** | Ebrahim |
| **Reviewed** | `fix-reviewer` agent: PASS (two wording notes applied) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** Anyone with a shop user's password is fully logged in after the password step; the OTP is never needed.
- **Why:** `lookupSession` checks a view that only filters revoked and expired sessions, so a half-finished (pre-OTP) session counts as a login.
- **What it breaks:** The second factor is useless: a leaked or guessed password gives full access to the shop's transactions, payment links, payouts and webhooks.

## 1. The issue

Merchant login is two steps: password → OTP. After step 1 the server already sets the session
cookie (a "pending" session, `authenticated = false`). That cookie alone was accepted by every
dashboard and API route:

```
POST /v1/auth/login  {merchantId, email, password}   → 200 (cookie set, OTP "required")
GET  /v1/auth/me             with that cookie         → 200
GET  /v1/transactions        with that cookie         → 200   ← no OTP ever entered
```

(In the reproduction, logging in with Alpha Retail's Merchant ID even returned **Beta Digital's**
shop: BUG-002 stacks on top, so a password for one shop opened another shop without any OTP.)

## 2. Why it happened

`apps/api/src/auth/sessions.ts` `lookupSession` (used by `requireMerchantAuth` on every route):

```ts
SELECT s.id AS session_id, s.merchant_user_id, mu.merchant_id, mu.role
  FROM live_sessions s
  JOIN merchant_users mu ON mu.id = s.merchant_user_id
 WHERE s.token_hash = $1
```

`db/migrations/0058_live_sessions.sql` defines `live_sessions` as sessions that are **not revoked
and not expired**; it has no `authenticated = true` filter. Migration 0012, which created the
table, states the rule plainly: *"Every query that authenticates a request must read
`WHERE token_hash = $1 AND authenticated = true AND revoked_at IS NULL AND expires_at > now()`"*.
Moving the query onto the view dropped the `authenticated` part.

The admin side kept it (`apps/api/src/adminAuth/sessions.ts`: `AND s.authenticated = true`), next to
the comment *"claude flagged authenticated = true as redundant with expires_at since pending sessions
only live 10 min"*. That reasoning is wrong (10 minutes of full access is enough) and is likely how
the merchant side lost it (TRAPS T-44). A missing test was also covered up: *"theres no test for a NOT
promoted session — am / MK: covered in routes/auth.test.ts"*. That file doesn't exist (T-45).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Anyone with a password (phished, reused, guessed) gets full dashboard and API access: transactions, payment links (create/cancel), webhook endpoints and secrets, settlement data | Critical |
| Customers (cardholders) | Their transaction data and payment links are exposed to whoever holds a merchant password | High |
| FilsPay | A second factor that doesn't work; regulatory exposure (CBB, PDPL) | Critical |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/auth/sessions.ts` | `lookupSession`: added `AND s.authenticated = true` and a comment explaining why the view isn't enough. |
| `apps/api/src/auth/sessions.test.ts` | New test: "lookupSession returns null for a pending session that never passed the OTP" (replaces the am/MK comment that claimed it was tested elsewhere). |

```ts
      WHERE s.token_hash = $1
        AND s.authenticated = true`,
```

One line in the one function every merchant route uses, matching the admin lookup and the rule
in 0012. The pending-session lookup (`lookupPendingSession`, used only by the OTP endpoints) is
unchanged, so OTP verify and resend still work.

Side effect (checked live): `POST /v1/auth/logout` with a **pending** cookie now answers 401 instead
of revoking it. That matches the admin side; the pending row expires on its own within 10 minutes
and the web client drops its local state either way.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Add `AND s.authenticated = true` in `lookupSession` | One line; exactly the 0012 rule; mirrors the admin lookup; no migration | The view's name ("live") still invites misuse | ✅ |
| 2 | New migration redefining `live_sessions` to include `authenticated = true` | Fixes every future user of the view | A migration for a view with a single caller; "live" ≠ "logged in", so it changes the view's meaning | |
| 3 | Both 1 and 2 | Belt and braces | More change than the root cause needs | |
| 4 | Outside the box: don't issue the session cookie until the OTP passes (pending state in a separate short-lived cookie or a signed challenge token) | The pre-OTP token could never be mistaken for a session, by design | Rewrites the login flow and both login pages; out of scope for a minimal fix (possible enhancement) | |

## 6. Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| lookupSession returns null for a pending session that never passed the OTP | `apps/api/src/auth/sessions.test.ts` | ❌ "a pre-OTP cookie must never act as a login" | ✅ |
| 4 existing lookupSession tests (active, unknown, revoked, expired) | same | ✅ | ✅ |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -v "$PWD/apps/api/src:/app/apps/api/src" api \
  npx tsx --test apps/api/src/auth/sessions.test.ts     # 5/5
# whole API suite: 366 tests, 354 pass, 12 fail = the same 12 as the T1 baseline (refund + webhook bugs)
# apps/api: npx tsc --noEmit → no errors
```

Real run (API rebuilt), password step only, then with the OTP:

| Request | Before | After |
|---|---|---|
| `GET /v1/auth/me` with the pre-OTP cookie | 200 | **401** |
| `GET /v1/transactions` with the pre-OTP cookie | 200 | **401** `unauthenticated` |
| `POST /v1/auth/otp/verify` with the right code, then `/me`, `/v1/transactions` | 200 / 200 | 200 / 200 (normal login unaffected) |

No existing assertion changed. One test was added to the existing `sessions.test.ts`, replacing the
false am/MK comment that said this case was tested elsewhere (T-45, D-004).
