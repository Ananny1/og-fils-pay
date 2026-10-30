# BUG-102 — Merchant login with a malformed merchantId crashes or answers differently

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Security |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/routes/auth.ts:60-66` at 8b58b0f (the `merchantId` from the body goes straight into `WHERE mu.merchant_id = $1` with no type or UUID check).

## Summary

- **What's wrong:** `POST /v1/auth/login` with `merchantId: "nope"` or `merchantId: {...}` did not answer the normal "invalid credentials".
- **Why:** the handler never checked that `merchantId` is a UUID string before using it.
- **What it breaks:** an object crashes with 500 (`merchantId.trim is not a function` in the throttle key); a non-UUID string made Postgres reject the uuid cast (500 in the original, 400 `invalid_input` after SEC-RT-6), so it looked different from a wrong password and was never counted as a failed login.

## 1. The issue

Send `{"merchantId":{"$ne":null},"email":"a@b.c","password":"x"}` → 500 internal_error.
Send `{"merchantId":"nope",...}` → 500 at 8b58b0f, 400 today; expected the same 401 `invalid_credentials` as any unknown user.

## 2. Root cause

```ts
// apps/api/src/routes/auth.ts (8b58b0f:55-66)
const { merchantId, email, password } = request.body ?? {};
if (!merchantId || !email || !password) { ... }   // only "present", never type/format
await app.db.query(`... WHERE mu.merchant_id = $1 AND mu.email = $2 ...`, [merchantId, email]);
```

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | none directly | low |
| Ops | 500s / error logs from junk login bodies | medium |
| Security | malformed ids bypassed the failed-login count and gave a distinct answer | low–medium |

## 4. Fix

- Non-string `merchantId` / `email` / `password` → 400 `invalid_request` (malformed body).
- A string `merchantId` that is not a UUID skips the query and is treated as an unknown user: dummy password hash, failure counted, 401 `invalid_credentials`. Uses the existing `UUID_RE`.
- OTP verify/resend checked: they take the user from the pending session, not from the body; an object `code` is string-concatenated into the hash and just fails as `invalid_code`. No change needed.

## 5. Options ranked

1. **Validate in the handler (chosen)** — smallest, keeps the generic 401 and the throttle count.
2. JSON schema on the route — Fastify would answer 400 with a schema message, which differs from 401 (gives away format).
3. Rely on the global 22P02 → 400 mapping (SEC-RT-6) — still a different answer and no failure count; does not cover the object crash.

## 6. Proof

Test: `apps/api/src/routes/auth.loginMerchantId.new.test.ts`

Before the fix:
```
✖ BUG-102: a merchantId that is not a UUID gets the generic 401, not a 500   (400 !== 401)
✖ BUG-102: a merchantId that is an object is a 400 bad request, not a 500    (500 !== 400, "merchantId.trim is not a function")
✔ BUG-102: a well-formed but unknown merchantId still gets the generic 401
```
After the fix (with `auth.new.test.ts` and `auth.throttle.test.ts`): `ℹ pass 28  ℹ fail 0`.
