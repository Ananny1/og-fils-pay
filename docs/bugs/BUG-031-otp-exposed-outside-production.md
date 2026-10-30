# BUG-031 — OTP code returned in the login response and logged unless NODE_ENV=production

| | |
|---|---|
| **Severity** | Critical (on the hosted box) |
| **Area** | Security · Deploy |
| **Analysis ID** | A5 |
| **Clue** | am's comment in `auth/notifier.ts` ("our staging has NODE_ENV unset btw"); compose has no `env_file:` for `ops/.env.docker` |
| **Decision** | — |
| **Commit** | see `git log --grep "BUG-031"` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

On any server where `NODE_ENV` is not exactly `production`, the login
response contained the OTP (`devOtpCode`) and the OTP was written to the logs
in plain text — for merchants **and** admins. So the second factor only
needed the password: log in, read the code from the response, verify.

`NODE_ENV` unset counts as "not production". The hosted compose stack does
not load `ops/.env.docker`, so it runs with `NODE_ENV` unset.

## 2. Why it happened — the root cause

`apps/api/src/config.ts`:

```ts
// before
otpDevExpose: parseBoolEnv(env.OTP_DEV_EXPOSE, nodeEnv !== "production"),
```

and `parseNodeEnv` turns an unset value into `"development"`. Exposure was
**on by default** and only turned off by a correct production env.

`auth/notifier.ts` and `adminAuth/notifier.ts` logged the raw code on the same
`nodeEnv !== 'production'` test, independent of `OTP_DEV_EXPOSE`, so even
`OTP_DEV_EXPOSE=false` still leaked it into logs.

False claims: "dev only — stripped in production builds" (`routes/auth.ts` —
nothing is stripped at build time); "staging gets NODE_ENV=production from
ops/.env.docker. fine" (compose never reads that file).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Via merchant takeover | High |
| Merchants | OTP useless on a mis-configured server: password alone logs in | Critical |
| FilsPay (finance / ops) | Same for admin accounts; OTPs sitting in log files | Critical |
| Acquirer / card scheme / partners | — | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/config.ts` | `otpDevExpose` defaults to `false`; only `OTP_DEV_EXPOSE=true` (or `1`) turns it on |
| `apps/api/src/auth/notifier.ts` | logs the code only when `config.otpDevExpose` |
| `apps/api/src/adminAuth/notifier.ts` | same |

```ts
// after
otpDevExpose: parseBoolEnv(env.OTP_DEV_EXPOSE, false),
```

**For developers:** to see the OTP locally (in the login response and in the
API log), set `OTP_DEV_EXPOSE=true`. `ops/.env.docker.example` already does.
Never set it on a hosted server.

The default is now safe: a forgotten or missing env var can only hide the
code, never expose it. One switch controls both the response and the log.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Default off; explicit dev opt-in; logs follow the same switch | Fail-safe; tiny change | Devs must set one env var | ✅ |
| 2 | Keep the default, fix compose to load NODE_ENV=production | Fixes this server | Next mis-configured server leaks again | |
| 3 | Remove the dev exposure entirely | Safest | Local dev and existing tests rely on it | |

**Why we chose #1:** security must not depend on an env var being present.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-031: OTP is not exposed by default, whatever NODE_ENV is` | `apps/api/src/auth/notifier.new.test.ts` | ❌ NODE_ENV unset exposed it | ✅ off for unset/development/test/production; on only with `OTP_DEV_EXPOSE=true` |
| `BUG-031: the OTP code is not logged unless OTP_DEV_EXPOSE is on` | same | ❌ code in merchant and admin log lines | ✅ no code; dev opt-in still logs |

```bash
cd apps/api && npx tsx --test src/auth/notifier.new.test.ts
```

Existing tests changed: none (they already pass `OTP_DEV_EXPOSE: "true"`).
