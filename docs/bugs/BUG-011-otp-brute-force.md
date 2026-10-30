# BUG-011 — OTP can be brute-forced: unlimited parallel guesses, resend resets the cap, predictable codes

| | |
|---|---|
| **Severity** | High |
| **Area** | Security |
| **Analysis ID** | A3, A4 |
| **Clue** | MK's own comment in `routes/auth.ts` ("if i fire 50 at once they all read attempt_count=0"); ARCHITECTURE "Tokens are 128-bit, from crypto.randomBytes" |
| **Decision** | — |
| **Commit** | see `git log --grep "BUG-011"` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

The OTP is meant to allow 5 guesses. Three separate faults made it much weaker:

1. **Parallel guesses.** Sending 25 wrong codes at once: all 25 were checked
   (test proof). With a 1,000,000-code space, sending thousands in parallel
   per login makes guessing realistic. Same on the **admin** login.
2. **Resend resets the budget.** `/v1/auth/otp/resend` created a fresh
   challenge with `attempt_count = 0`, although its own doc says "the new
   challenge inherits the previous challenge's attempt_count". So 5 more
   guesses every 30 seconds.
3. **Predictable codes.** OTP digits came from `Math.random()` (V8
   xorshift128+, not a secure generator; its state can be recovered from
   a few outputs). The same helper made **payment-link tokens** (the secret in
   a checkout URL) and admin invite codes. ARCHITECTURE says link tokens come
   from `crypto.randomBytes` — false. The `IssuedAdminOtpChallenge` JSDoc says
   "Generated with crypto.randomInt" — also false.

## 2. Why it happened — the root cause

`apps/api/src/routes/auth.ts` `/otp/verify` (and the copy in
`routes/adminAuth.ts`) read the counter, compared, then incremented in a
separate statement:

```ts
// before
if (challenge.attempt_count >= challenge.max_attempts) { ...429 }
const matches = verifyOtpCode(code, ...);
if (!matches) {
  await app.db.query(`UPDATE otp_challenges SET attempt_count = attempt_count + 1 WHERE id = $1`, ...);
```

Every parallel request read `attempt_count = 0` before any increment landed.
The admin comment "the challenge row is read FOR UPDATE" is false — it is a
plain SELECT outside any transaction.

`/otp/resend` called `issueChallenge`, which inserts `attempt_count` default 0.

`apps/api/src/lib/random.ts`:

```ts
// before
return Math.floor(Math.random() * max).toString().padStart(n, "0");
...
out += alphabet[Math.floor(Math.random() * alphabet.length)];
```

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Payment-link tokens guessable in principle | Medium |
| Merchants | Second factor could be brute-forced by anyone with the password | High |
| FilsPay (finance / ops) | Same for admin accounts (the most powerful plane) | High |
| Acquirer / card scheme / partners | — | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/auth.ts` `/otp/verify` | spend one attempt with a conditional `UPDATE ... WHERE attempt_count < max_attempts RETURNING` **before** comparing; no row → 429 + revoke |
| `apps/api/src/routes/adminAuth.ts` `/otp/verify` | same |
| `apps/api/src/routes/auth.ts` `/otp/resend` | copy the old challenge's `attempt_count` to the new one in the same transaction |
| `apps/api/src/lib/random.ts` | `crypto.randomInt` instead of `Math.random` (OTP digits, payment-link tokens, display refs) |
| `apps/api/src/admin/inviteCode.ts` | uses `randomFromAlphabet` (CSPRNG) instead of its own `Math.random` loop |

```ts
// after
const spent = await app.db.query(
  `UPDATE otp_challenges SET attempt_count = attempt_count + 1
    WHERE id = $1 AND attempt_count < max_attempts
    RETURNING attempt_count`, [challenge.id]);
if (spent.rowCount === 0) { revoke; throw 429 }
```

Postgres row locking makes the conditional UPDATE atomic: at most
`max_attempts` requests ever get a row back, however many arrive together.
A correct code also spends an attempt, so 4 wrong + the right one still logs
in, and nothing after the 5th guess is ever compared.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Atomic conditional UPDATE before compare | One statement, no lock held, works across replicas | Correct guess also counts (harmless) | ✅ |
| 2 | Transaction with `SELECT ... FOR UPDATE` | Familiar | Longer code; holds a lock per guess | |
| 3 | Rate limit the endpoint | Helps | Per-IP limits don't stop a distributed burst; doesn't fix the race | |

**Why we chose #1:** it removes the race itself with the smallest change.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-011: parallel wrong OTP guesses cannot exceed max_attempts` | `apps/api/src/routes/auth.new.test.ts` | ❌ 25 guesses checked (cap 5) | ✅ ≤ 5 |
| `BUG-011: parallel wrong admin OTP guesses ...` | `apps/api/src/routes/adminAuth.new.test.ts` | ❌ 25 checked | ✅ ≤ 5 |
| `BUG-011: an OTP resend keeps the guess budget already spent` | `auth.new.test.ts` | ❌ reset to 0 | ✅ 3 kept |
| `BUG-011: the real code still works after a few wrong guesses, and the 6th guess is refused` | `auth.new.test.ts` | ✅ | ✅ |
| `BUG-011: OTP digits do not come from Math.random` | `apps/api/src/lib/random.new.test.ts` | ❌ every OTP was 500000 with Math.random frozen | ✅ |
| `BUG-011: alphabet tokens ... and invite codes ...` | same | ❌ identical tokens | ✅ |

```bash
cd apps/api && npx tsx --test src/routes/auth.new.test.ts src/routes/adminAuth.new.test.ts src/lib/random.new.test.ts
```

Existing tests changed: none.
