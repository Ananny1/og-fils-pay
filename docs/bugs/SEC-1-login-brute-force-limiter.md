# SEC-1 — Login and OTP brute force: no rate limit, no account lockout

| | |
|---|---|
| **Severity** | High (admin login: Critical) |
| **Area** | Security (authentication) |
| **Analysis ID** | Security sprint item 2 (follow-up to BUG-011's "ENH-005") |
| **Clue** | BUG-011 option 4: "per-user/IP throttling, account lockout … more code and ops policy" |
| **Decision** | D-016 (security sprint) |
| **Commit** | this commit (`fix(SEC-1): ...`) |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** Anyone can try passwords on the shop and staff login as fast as they like, from one computer or many, and the account never locks.
- **Why:** `/v1/auth/login` and `/v1/admin/auth/login` checked the password and answered 401 with nothing counting failures; the OTP limit (BUG-011) is per code, so a new login gives 5 fresh guesses.
- **What it breaks:** Weak or leaked passwords get found by guessing (credential stuffing, password spraying), and with a known password the 6-digit code can be guessed 5 at a time, login after login.

## 1. The issue

| Attack (before) | Result |
|---|---|
| 1,000 wrong passwords for one email from one IP | 1,000 × 401, all checked |
| 1 password tried against 1,000 emails from one IP (spraying) | 1,000 × 401, all checked |
| Known password, then log in again and again, 5 wrong codes each time | Unlimited OTP guesses (5 per login) |
| Rotating `X-Forwarded-For` | Nothing to dodge yet, but any per-IP limit read from that header would be bypassed |

Reproduce: `for i in $(seq 50); do curl -s -XPOST :3000/v1/admin/auth/login -H 'content-type: application/json' -d '{"email":"x@y","password":"p'$i'"}'; done` → 50 × `invalid_credentials`.

## 2. Why it happened

`apps/api/src/routes/auth.ts` and `routes/adminAuth.ts` (before):

```ts
const passwordOk = await verifyPassword(user ? user.password_hash : DUMMY_PASSWORD_HASH, password);
if (!user || !passwordOk) {
  throw new UnauthorizedError("invalid_credentials");   // nothing recorded, nothing limited
}
```

No table, middleware or proxy counted failures. `request.ip` existed but nothing used it.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| FilsPay staff / admin plane | Guessed staff passwords → impersonation, adjustments, payouts | Critical |
| Merchants | Guessed shop passwords → dashboard, refunds, API keys | High |
| Customers | Refunds / payment links under an attacker's control | Medium |
| FilsPay | Fails PCI DSS 8.3.4 (lock after ≤ 10 tries) and CBB expectations | High |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0073_auth_failures.sql` | New `auth_failures` (plane, ip, subject, time) with an index per lookup: (plane, ip, time), (plane, subject, time), (time) for cleanup. |
| `db/migrations/0074_auth_lockouts.sql` | New `auth_lockouts` (plane, subject) → `locked_until`, index on `locked_until`. |
| `apps/api/src/auth/throttle.ts` | New. `reserveAttempt` (read-only check, then record the attempt up front and re-check, so parallel requests can't all slip through), `confirmFailure` (keep it; lock the account at the threshold), `releaseAttempt`, `clearFailures` (on full login), `assertNotThrottled`. Periodic cleanup of rows > 1 day, at most once per 10 min per process, only on the failure path. |
| `apps/api/src/routes/auth.ts` | Login, OTP verify and OTP resend use the throttle. Password OK only releases the attempt; the counter resets only after the OTP is verified. |
| `apps/api/src/routes/adminAuth.ts` | The same for the admin login and OTP verify. |
| `apps/api/src/config.ts` | `TRUST_PROXY` (default `false`), `TRUST_PROXY_ADDRESSES` (default `loopback,linklocal,uniquelocal`), and the six limits (`LOGIN_*`). |
| `apps/api/src/app.ts` | `trustProxy: config.trustProxy ? config.trustProxyAddresses : false`. |
| `apps/api/src/lib/errors.ts`, `plugins/errorHandler.ts` | `TooManyRequestsError` can carry `retryAfterSeconds`; the handler sends it as `Retry-After`. |
| `ops/.env.docker.example`, `ops/README.md` | Hosted box sets `TRUST_PROXY=true` (behind nginx). |

The limits (all configurable):

| Limit | Default | Answer |
|---|---|---|
| Failures per (client IP + account) | 5 per 60 s | 429 `too_many_attempts`, `Retry-After: 60` |
| Failures per client IP, any account (spraying) | 30 per 60 s | same |
| Failures per account, any IP (password or OTP) | 10 in 15 min → locked 15 min | same, `Retry-After` = time left |

- **No user enumeration:** the account key is what the client typed (merchant id + email, or admin email, trimmed and lower-cased), recorded whether or not the account exists. An unknown email is limited and locked exactly like a real one, with the same body: `{"error":"too_many_attempts","message":"Too many attempts. Try again later."}`.
- **Client IP:** Fastify 5 refuses hop counts, so `TRUST_PROXY=true` trusts `X-Forwarded-For` only from peers in `TRUST_PROXY_ADDRESSES`. The client IP is the first address, from the right, that isn't one of ours, so a fake left entry is ignored. With the default `false` the header is ignored completely. Note: with `ports: 3000:3000`, Docker makes outside clients look like the private gateway address, so `TRUST_PROXY=true` is only safe when the API port isn't published (nginx in front).
- **Scale:** all state is in Postgres (shared by every API instance); no in-memory maps. A refused request does one read and no writes; writes happen only on real failures, which the limits themselves cap.
- **Trade-off:** someone who knows a username can lock that user out for 15 minutes (the usual lockout cost). The per-IP limits make this slower, and nginx limits (separate item) add more.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Postgres failure log + lockout table, per IP+account / per IP / per account, reserve-then-check | Shared across instances; race-safe; no new dependency; covers OTP too | Two small tables; one extra query per login | ✅ |
| 2 | `@fastify/rate-limit` (in-memory) | Few lines | Per instance (N instances = N × the limit), counts all requests not failures, no lockout, new dependency | |
| 3 | nginx `limit_req` only | Cheap, stops floods early | Per-IP only: no per-account lockout, blind to spraying from many IPs and to OTP guessing across logins | (complements #1; separate item) |
| 4 | CAPTCHA / proof-of-work after N failures | Keeps the account usable during an attack | Frontend work and a third-party service | |

**Why we chose #1:** it's the only one that holds across several API instances and stops both per-account guessing (lockout) and spraying, with no new dependency.

## 6. Proof — tests

`apps/api/src/routes/auth.throttle.test.ts` (each test uses its own fake client IP):

| Test | Before | After |
|---|---|---|
| merchant / admin: the 6th wrong password from one IP for one email in a minute gets 429 (+ `Retry-After`) | ❌ 401 | ✅ |
| merchant / admin: 20 parallel wrong passwords are held to the per-email limit | ❌ 20 checked | ✅ ≤ 5 |
| merchant / admin: one IP spraying many emails is stopped at the per-IP limit | ❌ | ✅ 31st → 429 |
| merchant / admin: 10 failures from different IPs lock the account, and the lock expires | ❌ | ✅ |
| merchant / admin: a locked unknown email answers exactly like a locked real one | ❌ | ✅ |
| merchant / admin: wrong OTP codes across logins count toward the lockout | ❌ 3rd login works | ✅ 429 |
| merchant / admin: a successful login resets the failure count | ✅ (nothing to reset) | ✅ |
| merchant: the per-minute limit lifts after the window | ❌ | ✅ |
| TRUST_PROXY off: a rotating X-Forwarded-For doesn't dodge the limit | ❌ | ✅ |
| TRUST_PROXY on: the client IP is the one our proxy appended, not a spoofed left entry | ❌ | ✅ |
| TRUST_PROXY on: a client reaching the API directly still can't set its own IP | ❌ | ✅ |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -T -e DATABASE_URL=<db> \
  -v "$PWD/apps/api/src:/app/apps/api/src" -v "$PWD/db:/app/db" api \
  npx tsx --test apps/api/src/routes/auth.throttle.test.ts            # 18/18 (2 pass before: the reset tests)
# full API suite: 415 tests, 403 pass, 12 fail = the known refund + webhook baseline; tsc clean
```

Existing tests changed: none. `app.test.ts`, `admin.test.ts`, `auth.otpLimit.test.ts` and the
other login tests still pass (their few failures stay under the per-IP limit).
