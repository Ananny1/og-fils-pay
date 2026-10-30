# BUG-002 — OTP sent to another merchant's user; login lands in the wrong shop

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Security |
| **Analysis ID** | A2 |
| **Clue** | `0011_otp_challenges.sql` header ("never resolves an OTP by email"); `onboarding/signup.ts` comment by am |
| **Decision** | — |
| **Commit** | see `git log --grep "BUG-002"` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

One person can be a user at two merchants with the same email (for example
an accountant who works for two shops). When they logged in to shop B, the
OTP challenge and the pending session were created for their user at shop A
(whichever row the database returned first). After typing the OTP they were
logged into shop A, not shop B.

Worse, it is a cross-tenant path: the password checked belongs to shop B,
but the session that comes out is for shop A. Whoever controls a user at any
merchant with the same email as a user at another merchant gets a session
for that other merchant.

Reproduce: sign up two merchants with the same owner email, log in with
merchant B's id and password, verify the OTP, call `/v1/auth/me` — it shows
merchant A.

## 2. Why it happened — the root cause

`apps/api/src/routes/auth.ts` (login handler), after the password was checked
for the exact `(merchantId, email)` row:

```ts
// before
const recipient = await findOtpRecipient(app.db, email) ?? user;
```

`apps/api/src/auth/users.ts findOtpRecipient` looked the user up again **by
email only**, across all active merchants, `LIMIT 1` with no `ORDER BY`:

```sql
WHERE mu.email = $1 AND m.status = 'active' LIMIT 1
```

`merchant_users.email` is unique only per merchant (0003), so this returns
an arbitrary row. The challenge and the pending session were then created
for `recipient.id`, and `/otp/verify` promotes the session for that user.

False claim that hid it: `onboarding/signup.ts` "MK: login filters by
merchantId. verified" — the password lookup does, the OTP re-lookup does not.
The existing test "login resolves the OTP recipient to the same account"
used a unique email, so it could never catch it.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Their payment data visible to the wrong merchant's user | High |
| Merchants | A user of shop B ends up inside shop A (another tenant): data, API keys, payment links | Critical |
| FilsPay (finance / ops) | Tenant isolation broken | Critical |
| Acquirer / card scheme / partners | — | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/auth.ts` login | `const recipient = user;` (the row whose password was checked) |
| `apps/api/src/auth/users.ts` | deleted — `findOtpRecipient` had no other caller |

```ts
// after
const recipient = user;
```

The OTP, the pending session and the final session now always belong to the
exact user that proved the password. Nothing resolves a user by email alone.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Use `user` directly, delete the email re-lookup | Removes the root cause; one line | — | ✅ |
| 2 | Keep `findOtpRecipient` but add `merchant_id = $2` | Works | A second query that just returns the same row; easy to break again | |
| 3 | Add `ORDER BY` to make it deterministic | — | Still the wrong tenant, just predictably | |

**Why we chose #1:** the second lookup has no purpose; the right user is already in hand.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-002: with the same email at two merchants, ...` | `apps/api/src/routes/auth.new.test.ts` | ❌ "OTP challenge issued to the wrong merchant's user" | ✅ challenge, verify and `/me` all show merchant B |

```bash
cd apps/api && npx tsx --test src/routes/auth.new.test.ts
```

Existing tests changed: none.
