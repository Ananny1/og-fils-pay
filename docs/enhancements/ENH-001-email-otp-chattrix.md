# ENH-001 — Send the login OTP by email ("chattrix": Gmail SMTP, free)

| | |
|---|---|
| **Type** | Enhancement (not a bug: the brief doesn't require OTP delivery, and the original code says "no real email/SMS integration exists or is needed at this stage") |
| **Area** | Security · UX |
| **Related** | BUG-031 (the code no longer appears in the reply or the logs), ENH-008 (email verification at signup), ENH-002 (authenticator app) |
| **Approved by** | Ebrahim, 2026-10-30: add as an enhancement, after the required bug fixes |
| **Commit** | `feat(ENH-001): send the login OTP by email over SMTP` |
| **Status** | ✅ done (2026-10-30; hosted Gmail check still to do) |

## Summary

- **What it adds:** The 6-digit login code is emailed to the user, the way it would be in a real product.
- **Why it's worth it:** After BUG-031 the code is only visible in local dev mode. On a real (hosted) server, nobody can receive it, so nobody can log in. Email closes that gap, and the demo shows a complete, real login.
- **Cost / risk:** **Free.** About 3 small changes plus one free test service. The only "price" is a Gmail daily sending limit, which a demo never reaches.

## 1. Today

`apps/api/src/auth/notifier.ts` and `adminAuth/notifier.ts` are a **stub**: they only write a log
line. The code reaches the user in one way only: the dev switch `OTP_DEV_EXPOSE` (laptop only,
refused in production since BUG-031). On a hosted box, the login stops at "enter the code".

This isn't a bug: the brief and the original code both say delivery isn't needed at this stage.

## 2. Goal

- **Locally:** codes go to **Mailpit**, a fake inbox at http://localhost:8025. No real email leaves the laptop.
- **Hosted:** codes go to the user's real inbox through Gmail SMTP.
- The dev switch stays as it is (off by default, refused in production).
- A judge logs in on the hosted site and receives the code by email.

## 3. Why it's free

| Part | What it is | Cost |
|---|---|---|
| **"Chattrix" = Gmail SMTP + app password** | Ebrahim's setup from the VirtuThinko portal: a Gmail account sends the email over SMTP (`smtp.gmail.com`, port 465). Login uses a Google **app password**, a 16-character password made only for this app. | **Free** with any Gmail account. You need 2-Step Verification on the account to create an app password. Gmail limits sending to about 500 emails a day: enough for a demo and a small shop base. |
| **nodemailer** | The Node.js library that sends the email (the same one VirtuThinko uses) | **Free**, open source |
| **Mailpit** | A fake mail server for local runs; shows every email in a web page | **Free**, open source, one Docker container |
| Compared with SMS | — | SMS costs money per message (tens of fils each in Bahrain) and needs a provider contract |
| Compared with SendGrid / Amazon SES | — | Free tiers exist, but they need an account, domain checks and setup time |

**Security of the app password:** it lives **only** in `ops/.env.docker` on the server. That file
is git-ignored and is never committed or shown in docs. It can be revoked from the Google account
at any time without changing the Gmail password.

## 4. Design options (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | **SMTP via nodemailer** (Gmail app password hosted, Mailpit locally): reuse the VirtuThinko `src/server/mail/index.ts` pattern (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`) | Free; proven code we already wrote; works with any SMTP server later (SES, Outlook) by changing settings only | Gmail limit about 500 a day; mail from a Gmail address can land in spam | ✅ |
| 2 | Authenticator app (TOTP, e.g. Microsoft Authenticator) | No sending at all; strongest | Setup screen, QR code, encrypted secret, recovery codes, frontend: **ENH-002** | |
| 3 | Paid email API (SendGrid, SES API) | Better deliverability | Account, domain checks, keys; more work than the demo needs | |
| 4 | SMS | Familiar to Bahrain users | Costs per message; provider contract; SIM-swap risk | |

## 5. Planned changes

| File | Change |
|---|---|
| `apps/api/package.json`, `package-lock.json` | Add `nodemailer` 6.9.16 and `@types/nodemailer` 6.4.17 (exact versions; lock file made with the image's npm) |
| `apps/api/src/config.ts` | Optional `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`. No `SMTP_HOST` = today's behaviour (log only) |
| `apps/api/src/index.ts` | In production with no `SMTP_HOST`: a loud warning at boot ("nobody can log in"). Not fatal: checkout and API keys still work |
| `apps/api/src/lib/mail.ts` (new) | `sendMail()`, the VirtuThinko pattern. One transport per process, made on first send (nodemailer is loaded only then). `requireTLS` in production. Connect, greeting and socket timeouts plus an overall limit of 10 s per send |
| `apps/api/src/auth/notifier.ts`, `adminAuth/notifier.ts` | Now `async`. When `SMTP_HOST` is set: email the code to the user (code, how many minutes it is valid (`OTP_TTL_MINUTES` / `ADMIN_OTP_TTL_MINUTES`, default 5), "if this wasn't you, ignore this email"). A failed or slow send is logged without the code and never thrown, so the login still answers and the user can press "resend". The `OTP_DEV_EXPOSE` log line is unchanged |
| `apps/api/src/routes/auth.ts`, `routes/adminAuth.ts` | `await` the notifier (login and resend) |
| `ops/docker-compose.yml` | `mailpit` service (`axllent/mailpit:v1.21`, inbox at http://localhost:8025, SMTP 1025 on the compose network only); `api` starts after it |
| `ops/.env.dev` | `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_SECURE=false`, `MAIL_FROM` |
| `ops/.env.docker.example`, `ops/.env.prod.example` | Gmail values: `smtp.gmail.com`, `465`, `SMTP_SECURE=true`, empty `SMTP_USER` / `SMTP_PASSWORD` ("Gmail app password; never commit"), `MAIL_FROM` |

`ops/docker-compose.prod.yml` needs no change: every service there reads `ops/.env.prod` through `env_file`.

**Hosted box settings** (in the env file that is never committed: `ops/.env.prod` for the prod stack, `ops/.env.docker` for the laptop-style stack):

| Variable | Value |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_SECURE` | `true` |
| `SMTP_USER` | the Gmail address that sends the codes |
| `SMTP_PASSWORD` | that account's 16-character app password |
| `MAIL_FROM` | `FilsPay <the same Gmail address>` (Gmail rewrites any other sender) |

With the laptop-style stack, `ops/.env.dev` sets `SMTP_HOST=mailpit`, so a hosted `ops/.env.docker` **must** set `SMTP_HOST` itself, or the codes go to the local Mailpit.

## 6. Proof

**Tests** (`npm test` on its own database): api suite **442/442** (435 before + 7 new); all other suites green; `npm run typecheck` clean.

| Test | Shows |
|---|---|
| `auth/notifier.test.ts` (4 new) | With SMTP set, the merchant and the admin notifier each send exactly one mail, to the right address, containing the code, and log no code. Without `SMTP_HOST` nothing is sent. A failing send is logged (without the code), not thrown |
| `routes/auth.otpEmail.test.ts` (new, 2) | SMTP pointing at a closed port (real nodemailer, real DB): merchant and admin login still answer 200 |
| `config.test.ts` (1 new) | SMTP is off by default; the settings are read when set |

**Real run** (one-off Mailpit + one-off api on port 3201, `OTP_DEV_EXPOSE=false`, seeded owner of Delta Wholesale):

| Step | Result |
|---|---|
| `POST /v1/auth/login` | 200 `{"otpRequired":true,...}`, no `devOtpCode` |
| Mailpit API | 1 message, from `no-reply@filspay.local` to `owner@deltawholesale.example`, subject "Your FilsPay login code", body "Your FilsPay login code is: 707745 · It is valid for 5 minutes. · If this wasn't you, ignore this email and change your password." |
| `POST /v1/auth/otp/verify` with that code | 200 `{"authenticated":true,...}`; then `GET /v1/auth/me` 200 |
| api log | `otp code generated`, without the code (0 log lines contain it) |
| Mailpit stopped, login again | 200 after 10.07 s; log `otp email not sent: mail send timed out after 10000 ms` |

**Still to do:** hosted run with the Gmail app password, receiving the code in a real inbox.

## 7. Follow-ups

ENH-008 (confirm the owner's email at signup) can reuse the same `sendMail()`.

## 7. Follow-up: the login no longer waits for Gmail (2026-10-30)

Found in a real run with the hosted Gmail settings: the login waited for the mail server before
answering, **4.7–10 s**. That was slow, and it was a **user-enumeration leak**: a real account answered
slowly (an email is sent), an unknown email answered fast.

| | |
|---|---|
| **Fix** | `routes/auth.ts` (login, resend) and `routes/adminAuth.ts` (login) send the code in the background (`void sendOtpCode(...)`); the notifier already logs its own errors and never throws |
| **Test** | `apps/api/src/routes/auth.otpEmailSlow.test.ts`: a mail server that accepts the connection and never answers. Before: login took **10,208 ms** ❌. After: under 2 s ✅ |
| **Real run (hosted Gmail settings, code sent to our own inbox)** | Login **111 ms**, code not in the reply, no send error logged |
| **Suite** | API 503 / 503 |
| **Trade-off** | If the API process dies in the second after answering, that one email may not go out; the user presses "resend" |
