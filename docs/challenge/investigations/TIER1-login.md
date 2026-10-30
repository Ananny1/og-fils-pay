# Investigation — Tier 1 login bugs (BUG-002, BUG-011, BUG-031)

`bug-investigator` agent report, 2026-10-29 (read-only; live repros on the local stack). Condensed.
Used to plan each fix; the final evidence is in each bug's write-up.

## BUG-002 — OTP bound to another merchant's user with the same email
- **Root cause:** `apps/api/src/routes/auth.ts:78` `const recipient = await findOtpRecipient(app.db, email) ?? user;`
  → `apps/api/src/auth/users.ts:12-24` `WHERE mu.email = $1 AND m.status = 'active' LIMIT 1` (no merchant filter, no ORDER BY).
  Lines 82/88 bind `recipient.id` into `issueChallenge` and `createPendingSession`; the password was checked against `user` (correctly scoped).
  Which row wins depends on heap order: today logging into **Alpha** lands in **Beta**.
- **Worse:** public signup (`POST /v1/merchants`, `routes/businessProfile.ts:18` "am: anyone can register a second tenant with an existing owner's email"); new merchants default `status='active'`. Attacker signs up with the victim's email + own password, logs into own merchant → lands in the victim's tenant. With BUG-031 = takeover without the victim's password. → **BUG-037**.
- **Neighbours:** `/otp/resend` carries the wrong identity forward; admin emails are globally unique (not affected); `findOtpRecipient` has no other caller (dead after the fix).
- **Options:** (1) delete line 78 + import, use `user` ✅ · (2) + delete `users.ts` + assert merchant at verify (needs `sessions.merchant_id`) · (3) keep the function with `AND mu.merchant_id = $2` · (4) outside the box: people + memberships + merchant picker (ENH).
- **Tests:** two merchants sharing an email, each login lands in its own merchant (both directions); the challenge row's `merchant_user_id` = the logged-in merchant's user. Existing `app.test.ts:147` / `:181` pass without catching the bug (they stop at login / use unique emails).
- **Traps:** `onboarding/signup.ts:36-37` "MK: login filters by merchantId. verified"; `businessProfile.ts:19` "by design"; 0011 header "never resolves an OTP by email" (intent, not fact).

## BUG-011 — OTP guessable
- **(a) Race:** `routes/auth.ts:144-168` SELECT `attempt_count` → check → compare → `UPDATE attempt_count + 1`; no lock. **Live: 40 parallel wrong guesses → `attempt_count` 12 with max 5.**
- **(b) Weak RNG:** `lib/random.ts:4` `Math.floor(Math.random() * max)` (xorshift128+). Shared by `randomFromAlphabet` → payment-link bearer tokens (`paymentLinks/create.ts:11-12`), `admin/inviteCode.ts:10`.
- **(c) Resend resets the budget:** docstring `auth.ts:196-197` says the new challenge inherits `attempt_count` — false: `issueChallenge` (`auth/otp.ts:47-51`) inserts a fresh row (0). ~80+ guesses per 10-min pending session. Resend's 30 s check is check-then-act too.
- **(d)** Successful verify consumes without `WHERE consumed_at IS NULL` → two parallel correct codes both succeed.
- **Admin twin:** `routes/adminAuth.ts:126-160` same race; comment line 147 "read FOR UPDATE — MK" false; `adminAuth/otp.ts:13` "Generated with crypto.randomInt" false (uses the same `generateOtpCode`).
- **Options:** (1) atomic `UPDATE … SET attempt_count = attempt_count + 1 WHERE id=$1 AND consumed_at IS NULL AND expires_at > now() AND attempt_count < max_attempts RETURNING …`, consume with `WHERE consumed_at IS NULL RETURNING`, `crypto.randomInt`, resend copies `attempt_count` (+ `FOR UPDATE`), same for admin ✅ · (2) `SELECT … FOR UPDATE` in a transaction (holds a pool connection per guess, pool max 5) · (3) per-session attempt budget column (migration) · (4) outside the box: per-user/IP throttle + lockout + alert (ENH-005).
- **Tests:** 20 parallel wrong guesses → ≤ max evaluated; resend keeps the budget; two parallel correct codes promote once; exhausted budget rejects even the right code; admin twin; `generateOtpCode` must not call `Math.random`.
- **Traps:** `auth.ts:196-197`, `adminAuth.ts:147`, `adminAuth/otp.ts:13`, `auth.ts:156` "am: … worst case is 5 guesses", `sessions.ts:115` "MK: 5/14 was webhooks".

## BUG-031 — OTP in the login reply and in logs
- **Root cause:** `config.ts:214` `otpDevExpose: parseBoolEnv(env.OTP_DEV_EXPOSE, nodeEnv !== "production")`; unset `NODE_ENV` → development. No guard against `production` + `OTP_DEV_EXPOSE=true`. Reply: `routes/auth.ts:111-114`, `:249-251`, `routes/adminAuth.ts:105-107`. Logs use a **different** switch: `auth/notifier.ts` and `adminAuth/notifier.ts` log `code` whenever `nodeEnv !== "production"`. `ops/.env.docker.example` ships `NODE_ENV=development`, `OTP_DEV_EXPOSE=true`.
- **Live:** login reply has `devOtpCode`; `docker logs ops-api-1` shows `"code":"788406"`.
- **Options:** (1) default `otpDevExpose` false; `loadConfig` throws on production + expose; notifiers log the code only when `otpDevExpose`; keep `OTP_DEV_EXPOSE=true` in `ops/.env.dev`, hosted values in `.env.docker.example` ✅ · (2) remove dev exposure, add SMTP/Mailpit (ENH-001) · (3) default `NODE_ENV` to production · (4) loopback-only exposure + boot banner.
- **Tests:** `OTP_DEV_EXPOSE` unset → false in every env; production + expose refuses to boot; notifiers don't log the code unless `otpDevExpose` (stub logger); login reply has no `devOtpCode` when unset. Existing route tests set `OTP_DEV_EXPOSE: "true"` explicitly (unaffected).
- **Traps:** `auth.ts:111` "stripped in production builds" (no such build step); `notifier.ts:97` YA staging claim (T-39); `dashboardAuth.ts:28` MK "only when NODE_ENV != production".
