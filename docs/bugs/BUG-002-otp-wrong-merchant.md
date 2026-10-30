# BUG-002 — The OTP logs you into another shop that uses the same email

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Security (authentication, tenant isolation) |
| **Analysis ID** | A2 |
| **Clue** | S4 "the OTP implementation changed at some point. is it still safe?"; migration 0011 header "no code path … resolves an OTP challenge by joining on merchant_users.email" |
| **Evidence** | S4 |
| **Decision** | D-003 |
| **Owner** | Ebrahim |
| **Investigation** | `docs/challenge/investigations/TIER1-login.md` |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** A user whose email exists in two shops logs into shop A with A's password and ends up inside shop B.
- **Why:** After checking the password, the login looks the user up again **by email only** (any active shop, first row wins) and binds the OTP and session to that row.
- **What it breaks:** Tenant isolation: people see and act on another merchant's transactions, links and payouts. Because signup is public (BUG-037), an attacker can register a new shop with a victim's email and land in the victim's shop.

## 1. The issue

`owner@alpharetail.example` is a user in **Alpha Retail** and in **Beta Digital** (seed data).
Logging in with Alpha's Merchant ID, Alpha's password and the OTP:

```
POST /v1/auth/login {merchantId: 9972daab… (Alpha), email, password} → 200
POST /v1/auth/otp/verify {code}                                     → 200
GET  /v1/auth/me  → "merchant": {"id": "3a1a204a…", "displayName": "Beta Digital Services"}
```

Which shop "wins" depends on the order Postgres returns rows; it is the same every time, so all
users of one of the two shops always land in the other.

## 2. Why it happened

`apps/api/src/routes/auth.ts` (login), after the password was verified against the **correctly
scoped** user (`WHERE mu.merchant_id = $1 AND mu.email = $2`):

```ts
const recipient = await findOtpRecipient(app.db, email) ?? user;
// … issueChallenge({ merchantUserId: recipient.id }) / createPendingSession({ merchantUserId: recipient.id })
```

`apps/api/src/auth/users.ts` `findOtpRecipient`:

```sql
SELECT … FROM merchant_users mu JOIN merchants m ON m.id = mu.merchant_id
 WHERE mu.email = $1 AND m.status = 'active'
 LIMIT 1          -- no merchant filter, no ORDER BY
```

So the identity is **switched** after authentication: the password proves you are A's user, but the
OTP challenge and the session (promoted at `/otp/verify`) belong to whichever row comes first.

Why tests missed it: `app.test.ts` "a second merchant sharing the same owner email resolves
correctly…" stops at the password step and never verifies the OTP or calls `/me`; "login resolves the
OTP recipient to the same account" uses a unique email. Comments that hid it: `onboarding/signup.ts`
"MK: login filters by merchantId. verified" (only the password check does), and 0011's promise,
which describes the intent, not the code.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants sharing an email (group finance, bookkeepers, the seeded Alpha/Beta owner) | Land in the wrong shop; see and act on its transactions, refunds, payment links, webhooks, payouts | Critical |
| Any merchant (with BUG-037 + BUG-031) | Anyone can sign up a new shop with the victim's email, log into their own shop, and land in the victim's | Critical: account takeover |
| Customers | Their payment data is visible to another merchant | High |
| FilsPay | Cross-tenant data breach (PDPL), trust | Critical |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/auth.ts` | Removed the `findOtpRecipient(...) ?? user` lookup and its import; the challenge, pending session and notification use `user`, the row the password was checked against. |
| `apps/api/src/routes/auth.otpRecipient.test.ts` | New: two merchants sharing an email, each login lands in its own merchant (both directions); the OTP challenge row belongs to the merchant that was logged into. |

```diff
-    const recipient = await findOtpRecipient(app.db, email) ?? user;
-        merchantUserId: recipient.id,
+        merchantUserId: user.id,
```

`apps/api/src/auth/users.ts` (`findOtpRecipient`) now has no callers. It is left in place to keep
this commit minimal; removing it is listed as an enhancement (ENH-007).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Drop the email lookup, use the scoped `user` | One line; restores the rule in 0011; nothing new to maintain | Leaves a dead helper | ✅ |
| 2 | Keep `findOtpRecipient` but add `AND mu.merchant_id = $2` | Keeps a "recipient" abstraction | Re-runs the lookup that was just done; keeps a trap-shaped function | |
| 3 | Option 1 + store `merchant_id` on the session and assert it at `/otp/verify` | Defence in depth | Migration on `sessions` for no extra protection once the identity isn't switched | |
| 4 | Outside the box: one person record per email with memberships, and a shop picker after the OTP | Removes the ambiguity entirely (how Stripe/Shopify work) | Large migration and UX change; an enhancement, not a fix | |

The related signup problem (anyone can attach an existing email to a new shop without confirming
it) is its own bug, **BUG-037**, so this commit stays about the login.

## 6. Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| two merchants sharing an owner email: each login lands in its own merchant | `apps/api/src/routes/auth.otpRecipient.test.ts` | ❌ "logging into B must land in B" | ✅ |
| the OTP challenge is issued to the user whose password was checked | same | ❌ challenge belonged to the other merchant | ✅ |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -v "$PWD/apps/api/src:/app/apps/api/src" api \
  npx tsx --test apps/api/src/routes/auth.otpRecipient.test.ts     # 2/2
# API suite: 368 tests, 356 pass, 12 fail = the 12 baseline failures (refund + webhook)
# apps/api: tsc --noEmit → no errors
```

Real run (API rebuilt), `owner@alpharetail.example` / seed password, with the OTP:

| Logged into | `/me` before | `/me` after |
|---|---|---|
| Alpha Retail (`9972daab…`) | **Beta Digital Services** | Alpha Retail Co |
| Beta Digital (`3a1a204a…`) | Beta Digital Services | Beta Digital Services |

No existing test changed.
