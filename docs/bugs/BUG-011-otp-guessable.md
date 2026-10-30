# BUG-011 — The OTP can be guessed: parallel tries, resend resets, weak random

| | |
|---|---|
| **Severity** | High (Critical on the admin login) |
| **Area** | Security (authentication) |
| **Analysis ID** | A3, A4 |
| **Clue** | S4 "the OTP implementation changed at some point. is it still safe?"; MK in `auth.ts`: "if i fire 50 at once they all read attempt_count=0" |
| **Evidence** | S4 |
| **Decision** | D-003 |
| **Owner** | Ebrahim |
| **Investigation** | `docs/challenge/investigations/TIER1-login.md` |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** The "5 tries" limit on the 6-digit code doesn't hold: parallel requests all get checked, a resend gives 5 fresh tries, and codes come from a predictable random generator, on both the merchant and the admin login.
- **Why:** The try counter is read, checked and only then increased (no lock); a resend creates a new code with the counter at 0; codes use `Math.random`.
- **What it breaks:** The second factor can be brute-forced by anyone with a password, including on the admin console (impersonation, adjustments, payouts).

## 1. The issue

| Attack | Before |
|---|---|
| 20 wrong guesses in parallel (test) | **20** checked against the code; limit 5 (merchant and admin) |
| 40 wrong guesses in parallel (live, curl) | `attempt_count` ended at **12** / max 5 |
| 4 wrong guesses, then resend | new code with **0** used tries: 4 + 5 + 5 … about 80 guesses per 10-minute pending login |
| 2 correct codes in parallel | **both** succeed |
| Code generation | `Math.random()` (V8 xorshift128+): its state can be recovered from outputs, and the same helper makes payment-link tokens and admin invite codes |

## 2. Why it happened

`apps/api/src/routes/auth.ts` `/otp/verify` (the admin route was a copy):

```ts
SELECT … attempt_count, max_attempts … FROM otp_challenges WHERE id = $1     // read
if (challenge.attempt_count >= challenge.max_attempts) { … 429 }               // check
const matches = verifyOtpCode(code, …)                                         // compare
if (!matches) UPDATE otp_challenges SET attempt_count = attempt_count + 1      // count, afterwards
…
UPDATE otp_challenges SET consumed_at = now() WHERE id = $1                    // no "consumed_at IS NULL"
```

N parallel requests all read the same count and each gets a free comparison. `/otp/resend`
consumes the old code and calls `issueChallenge`, which inserts a new row with `attempt_count`
0. Its docstring claims the opposite (T-47). `apps/api/src/lib/random.ts` `randomDigits` used
`Math.floor(Math.random() * 10**n)`.

Comments that hid it: am "check-then-increment is fine … worst case is 5 guesses" (T-49); MK on the
admin side: "doesn't have the merchant race, the challenge row is read FOR UPDATE" (no lock and no
transaction, T-48); `adminAuth/otp.ts` "Generated with crypto.randomInt" (it wasn't, T-48).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| FilsPay staff / admin plane | A leaked admin password + guessing gives impersonation, balance adjustments, payouts | Critical |
| Merchants | A leaked password + guessing gives the full dashboard | High |
| Customers | Payment-link tokens came from the same weak generator | Medium |
| FilsPay | 2FA weaker than claimed (CBB / PDPL) | High |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/auth.ts` `/otp/verify` | **Reserve an attempt before comparing**, in one statement: `UPDATE otp_challenges SET attempt_count = attempt_count + 1 WHERE id = $1 AND consumed_at IS NULL AND attempt_count < max_attempts RETURNING id`. No row → if already consumed, 410 (don't log out the winner); else revoke + 429. Consume with `… WHERE id = $1 AND consumed_at IS NULL RETURNING id`; no row → 410. |
| `apps/api/src/routes/adminAuth.ts` `/otp/verify` | The same, on `admin_otp_challenges`. |
| `apps/api/src/routes/auth.ts` `/otp/resend` | In one transaction: lock the old challenge (`FOR UPDATE`), apply the 30 s throttle under the lock, and **copy its `attempt_count`** to the new challenge. |
| `apps/api/src/lib/random.ts` | `randomDigits` and `randomFromAlphabet` use `crypto.randomInt`. This also makes payment-link tokens and admin invite codes unpredictable (same helper). |
| `apps/api/src/routes/auth.otpLimit.test.ts` | New tests (below). |

Served one request at a time, the behaviour is unchanged: 5 submissions per code, and the 5th can
still be the right one. Removed the am / MK comments that the tests prove false.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Atomic "reserve an attempt" UPDATE + single-winner consume + resend carries the count + CSPRNG, on both logins | No migration; one statement per step; no extra locking cost | A correct code sent after the budget is spent is refused (intended) | ✅ |
| 2 | `SELECT … FOR UPDATE` in a transaction around check, compare and increment | Easy to read | Holds a pool connection per guess (pool max 5): an easy way to starve the API | |
| 3 | A per-session attempt budget column (+ cap on resends) | Survives any number of codes | Migration; option 1 already carries the count | |
| 4 | Outside the box: per-user/IP throttling, account lockout and alerts after N failed OTPs across logins | Also stops "new login = new budget" | More code and ops policy: **ENH-005** | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| merchant: 20 parallel wrong guesses are held to max_attempts | `apps/api/src/routes/auth.otpLimit.test.ts` | ❌ 20 checked | ✅ |
| merchant: two parallel correct codes log in exactly once | same | ❌ | ✅ |
| admin: 20 parallel wrong guesses are held to max_attempts | same | ❌ 20 checked | ✅ |
| admin: two parallel correct codes log in exactly once | same | ❌ | ✅ |
| merchant: a resend keeps the attempts already used | same | ❌ new code had 0 | ✅ 4 carried |
| OTP codes don't come from Math.random | same | ❌ | ✅ |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -v "$PWD/apps/api/src:/app/apps/api/src" api \
  npx tsx --test apps/api/src/routes/auth.otpLimit.test.ts      # 6/6
# API suite: 379 tests, 367 pass, 12 fail = the T1 baseline (refund + webhook); tsc clean
```

Live, 40 parallel wrong guesses with curl on the rebuilt API: `attempt_count` **12 / 5 → 5 / 5**
(16 × 401: at most 5 real guesses plus "no pending session" after the revoke; 24 × 429).

No existing test changed; the serial tests in `app.test.ts` / `admin.test.ts` still pass.
