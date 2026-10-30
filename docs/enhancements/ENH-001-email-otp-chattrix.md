# ENH-001 — Send the login OTP by email ("chattrix": Gmail SMTP, free)

| | |
|---|---|
| **Type** | Enhancement (not a bug: the brief doesn't require OTP delivery, and the original code says "no real email/SMS integration exists or is needed at this stage") |
| **Area** | Security · UX |
| **Related** | BUG-031 (the code no longer appears in the reply or the logs), ENH-008 (email verification at signup), ENH-002 (authenticator app) |
| **Approved by** | Ebrahim, 2026-10-30: add as an enhancement, after the required bug fixes |
| **Commit** | — |
| **Status** | ✔️ approved (after Tiers 2–6) |

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
| `apps/api/package.json` | Add `nodemailer` |
| `apps/api/src/config.ts` | Optional `SMTP_*` / `MAIL_FROM` settings; no SMTP host configured = today's behaviour (log only) |
| `apps/api/src/lib/mail.ts` (new) | `sendMail()`, the VirtuThinko pattern |
| `apps/api/src/auth/notifier.ts`, `adminAuth/notifier.ts` | Email the code when SMTP is configured (never log it) |
| `ops/docker-compose.yml` | `mailpit` service (ports 1025 / 8025) for local runs |
| `ops/.env.dev` | `SMTP_HOST=mailpit`, `SMTP_PORT=1025` |
| `ops/.env.docker.example` | `smtp.gmail.com`, `465`, `SMTP_SECURE=true`, empty user / password placeholders |

## 6. Proof (to do)

- Unit test: with SMTP set, the notifier sends one email with the code and logs no code.
- Real run: log in locally and see the code in Mailpit at :8025.
- Hosted: log in and receive the code in a real inbox.

## 7. Follow-ups

ENH-008 (confirm the owner's email at signup) can reuse the same `sendMail()`.
