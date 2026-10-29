# BUG-031 — The OTP code is handed out in the login reply and written to the logs

| | |
|---|---|
| **Severity** | Critical (when deployed) |
| **Area** | Security (authentication, secrets in logs) |
| **Analysis ID** | A5 |
| **Clue** | S4 "the OTP implementation changed at some point. is it still safe?"; `auth.ts` "dev only — stripped in production builds" (T-50); YA "staging gets NODE_ENV=production" (T-39) |
| **Evidence** | S4 |
| **Decision** | D-003 |
| **Owner** | Ebrahim |
| **Investigation** | `docs/challenge/investigations/TIER1-login.md` |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** On any server that doesn't explicitly say `NODE_ENV=production`, the login reply contains the OTP code and the server log prints it.
- **Why:** The "show the OTP" switch defaults to on outside production (and an unset `NODE_ENV` counts as development); the log uses a second switch with the same default; nothing stops production from turning it on.
- **What it breaks:** The second factor: anyone with a password reads the code from the reply (merchants **and** admins), and anyone with log access can log in as whoever is logging in.

## 1. The issue

Before the fix, on the local stack and on any box that forgot `NODE_ENV=production`:

```
POST /v1/auth/login → {"otpRequired":true, "otpExpiresAt":"…", "devOtpCode":"788406"}
docker logs ops-api-1 → {"merchantUserId":"233c2044…","channel":"otp","code":"788406","msg":"otp code generated (dev)"}
```

The same for the admin login (`/v1/admin/auth/login`) and `/v1/auth/otp/resend`. The dashboards
even print it on the page ("Development code: …").

## 2. Why it happened

- `apps/api/src/config.ts`: `otpDevExpose: parseBoolEnv(env.OTP_DEV_EXPOSE, nodeEnv !== "production")`,
  and `parseNodeEnv` maps a missing or unknown `NODE_ENV` to `"development"`. Exposure was the
  **default**, so a deploy only had to forget one variable. DEP-003 showed this really happened: the
  hosted compose never loaded its env file.
- No guard: `NODE_ENV=production` **with** `OTP_DEV_EXPOSE=true` booted fine (unlike
  `SETTLEMENT_INTERNAL_TOKEN`, which fails boot).
- `apps/api/src/auth/notifier.ts` and `adminAuth/notifier.ts` logged the code on a **separate**
  condition (`nodeEnv !== "production"`), so even `OTP_DEV_EXPOSE=false` still logged it.
- `ops/.env.docker.example` shipped `NODE_ENV=development` / `OTP_DEV_EXPOSE=true`: copy-and-deploy leaked.
- Comments that hid it: "dev only — stripped in production builds" (there is no such build step, T-50);
  "staging gets NODE_ENV=production from ops/.env.docker" (it didn't, T-39).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | A stolen or guessed password is enough: the OTP is in the reply | Critical |
| FilsPay staff (admin plane) | Same for admin logins: impersonation, adjustments, payouts | Critical |
| Anyone with log access (ops, log vendors) | Can complete any login in progress | High |
| FilsPay | 2FA claimed but not delivered; PDPL / CBB exposure | High |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/config.ts` | `OTP_DEV_EXPOSE` now defaults to **false** in every environment; `loadConfig` throws if `NODE_ENV=production` and it's enabled. |
| `apps/api/src/auth/notifier.ts`, `apps/api/src/adminAuth/notifier.ts` | Log the raw code only when `config.otpDevExpose` is on: **one switch** for the reply and the log. |
| `ops/.env.dev` | `OTP_DEV_EXPOSE=true` for the laptop demo (the brief's `docker compose up`), with a comment. |
| `ops/.env.docker.example` | Now shows the **hosted** values: `NODE_ENV=production`, `OTP_DEV_EXPOSE=false`. |
| `apps/api/src/config.test.ts`, `apps/api/src/auth/notifier.test.ts` | New tests (below). |

Route code is unchanged: it already gated `devOtpCode` on `otpDevExpose`. Existing route tests set
`OTP_DEV_EXPOSE: "true"` explicitly, so they keep working.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Default off + refuse in production + one switch for reply and log; the laptop file opts in | Secure by default; a forgotten variable no longer leaks; local demo still works; small | A local `npm run dev` outside Docker needs `OTP_DEV_EXPOSE=true` to see codes | ✅ |
| 2 | Remove dev exposure entirely and deliver codes by email (SMTP + Mailpit locally) | No leak path at all | A new feature (compose service, dependency, templates): that's **ENH-001** | |
| 3 | Treat an unset `NODE_ENV` as production | Fails closed for cookies too | Changes boot for every service and test that leaves it unset | |
| 4 | Outside the box: expose codes only to loopback requests, with a loud boot banner | Hard to leak by accident | Still a code path that can leak through a proxy; friction, not a fix | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| the OTP is never exposed unless OTP_DEV_EXPOSE is set explicitly | `apps/api/src/config.test.ts` | ❌ | ✅ |
| production refuses to boot with OTP_DEV_EXPOSE turned on | same | ❌ | ✅ |
| the merchant OTP code is not logged unless otpDevExpose is on | `apps/api/src/auth/notifier.test.ts` | ❌ | ✅ |
| the admin OTP code is not logged unless otpDevExpose is on | same | ❌ | ✅ |
| with otpDevExpose on (local demo), the code is logged for the developer | same | ✅ | ✅ |

API suite: 373 tests, 361 pass, 12 fail = the T1 baseline failures (refund + webhook). `tsc` clean.

Real runs (API rebuilt):

| Scenario | Before | After |
|---|---|---|
| Laptop stack (`ops/.env.dev` opts in) | code in reply | code in reply (intended for the demo) |
| A box that forgets `OTP_DEV_EXPOSE` / `NODE_ENV` | code in reply **and** log | `{"otpRequired":true,"otpExpiresAt":"…"}`, **0** codes in the log |
| `NODE_ENV=production` + `OTP_DEV_EXPOSE=true` | boots, leaks | refuses: `loadConfig: OTP_DEV_EXPOSE must not be enabled when NODE_ENV=production` |

Follow-ups: F3 (login pages without the on-screen code), ENH-001 (email delivery). No existing test changed.
