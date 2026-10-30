# FilsPay security controls (CIA map)

Plain-words list of every control, grouped by **C**onfidentiality, **I**ntegrity, **A**vailability.
Each row says where it lives and how we proved it. Write-ups are in `docs/bugs/`.

Status: ✅ in code with a test · ⏳ being done in a parallel security stream (SEC-1..5, merged
separately) · 📋 ops step / recommendation, not code.

## C — Confidentiality: only the right people see the data

| Control | What it means in plain words | Where | Status |
|---|---|---|---|
| Password + OTP login | A password alone never logs you in; the OTP is checked for the right user | `auth/`, BUG-001, BUG-002 | ✅ |
| OTP hard to guess | Crypto random code, attempt limit counted in the DB, resend does not reset tries | BUG-011 | ✅ |
| OTP never shown or logged in production | Code only in reply/log on a laptop with `OTP_DEV_EXPOSE`; refused in production | BUG-031 | ✅ |
| New session after OTP | The pre-login cookie can't become the logged-in session (no fixation) | BUG-032 | ✅ |
| Shops can't see each other | Every lookup is filtered by the caller's merchant id (no IDOR) | BUG-003, BUG-010 | ✅ |
| Staff "view as merchant" is read-only | Impersonation can't write and doesn't get owner powers | BUG-010 | ✅ |
| Admin roles checked on every admin route | Support staff can't issue money credits | BUG-033 | ✅ |
| Passwords hashed with argon2id | 19 MiB memory, 2 passes, 1 lane (OWASP minimum); never plain or md5/sha | `auth/passwords.ts` | ✅ |
| OTP codes stored as salted hash | Raw code is never stored | `auth/otp.ts` | ✅ |
| Session, admin session, impersonation and API-key tokens stored as sha256 | A DB leak gives no usable token | `auth/sessions.ts`, `adminAuth/sessions.ts`, `admin/impersonation.ts`, `apiKeys/issue.ts` | ✅ |
| API key shown once; rotation kills the old key | | BUG-012 | ✅ |
| Webhook secrets encrypted (AES-256-GCM) | Needed in clear at send time, so encrypted, not hashed | `webhooks/secretCrypto.ts` | ✅ |
| **KYC documents encrypted on disk** | ID scans, CR and bank letters are AES-256-GCM on disk; download decrypts | SEC-4 `SEC-4-kyc-encrypted-at-rest.md` | ✅ |
| Cookies `httpOnly`, `sameSite=lax`, `secure` in production | JavaScript can't read the session cookie | `routes/auth.ts`, `config.ts` | ✅ |
| No secrets in logs | Request logs carry method/url/ip only (Fastify default, no headers or bodies); OTP logged only in dev; API keys, tokens, passwords and card data are never passed to a logger (checked every `log.*` / `console.*` call) | SEC-4 audit | ✅ |
| Idle session timeout | Logged out after inactivity (staff shorter than shops) | SEC stream | ⏳ |
| Security headers, no stack traces | HSTS, no-sniff, frame-deny; 500 replies are just `internal_error` | `plugins/errorHandler.ts` + SEC stream | ✅ errors / ⏳ headers |
| HTTPS only for webhooks in production | | `webhooks/create.ts` | ✅ |
| Postgres not public, least-privilege DB roles | | D5, ENH-006 | 📋 |

## I — Integrity: data and money stay correct

| Control | What it means in plain words | Where | Status |
|---|---|---|---|
| Money is integer fils | 1 BD = 1000 fils; no floats anywhere money is computed | BUG-015, BUG-016, BUG-021, BUG-022 | ✅ |
| A payment link can't be charged twice | Row lock held from claim to finalize | BUG-005 | ✅ |
| Expired link can't be paid | Server time, not the client's `submittedAt` | BUG-004 | ✅ |
| Idempotency keys on payments and refunds; DB locks on refunds | Double click / two refunds at once = one result | BUG-005, BUG-034 | ✅ / ⏳ |
| Signed outgoing webhooks, verified acquirer callbacks | Fake callbacks and replays are rejected | `webhooks/sign.ts`, `inboundVerify.ts`, BUG-007, BUG-023 | ⏳ |
| **Leaked acquirer secret refused** | The secret committed in git history (and dev / `change-me` values) can't be used in production; boot fails | SEC-4 `SEC-4-leaked-secret-refused.md` | ✅ code / 📋 rotate |
| Encrypted data is tamper-evident | AES-GCM tag: a changed KYC file or webhook secret fails to decrypt instead of being used | `secretCrypto.ts` | ✅ |
| Two-person check on credits by user id | A renamed admin can't approve their own credit | BUG-013 | ✅ |
| Admin audit log | Every admin money/settlement action is recorded with outcome | `adminAudit/` | ✅ |
| Settlement day = Bahrain midnight | Daily close at 21:00 UTC | BUG-020 | ✅ |
| CSV formula injection blocked | Exports can't run formulas in Excel | BUG-030 | ⏳ |
| Fail-closed config | Production refuses to boot without real keys, with dev OTP exposure, or with a known public secret | `config.ts`, BUG-031, BUG-058, SEC-4 | ✅ |
| AI-instruction poisoning removed | Agent files no longer tell tools to keep bugs | BUG-050 | ✅ |

## A — Availability: it stays up

| Control | What it means in plain words | Where | Status |
|---|---|---|---|
| Rate and connection limits | A flood gets 429/503, not a crash | nginx (SEC stream) | ⏳ |
| Login / OTP limiter and lockout | Shared in Postgres so it works with several API instances | SEC stream | ⏳ |
| Bounded DB pool, timeouts | Pool max/min/idle/connect timeouts from config | `db/pool.ts`, `config.ts` | ✅ |
| Health checks | `/healthz` / `readyz` routes; Postgres healthcheck in compose | `routes/health.ts`, `ops/docker-compose.yml` | ✅ |
| Auto-restart, `readyz` re-checks the DB | | D7, ops (SEC stream) | ⏳ |
| Webhook retries with capped backoff; one bad endpoint can't stop others | | `webhooks/dispatcher.ts` | ✅ |
| `expire_holds` can't wipe every hold | | BUG-009 | ✅ |
| Fresh deploy works | Dockerfiles, migrations, env loading | DEP-001..005 | ✅ |
| Backups (encrypted KYC files included) | | ops | 📋 |

## Dependencies (`npm audit --omit=dev`, run 2026-10-30 in the api image)

5 findings: 0 critical, **1 high**, 4 moderate. None upgraded blindly; each needs a rebuilt image and
a full test run.

| Package (installed range) | Severity | Issue | Do we hit it? | Recommendation |
|---|---|---|---|---|
| `sharp` ^0.33.5 (api) | **High** | libvips / libheif / librsvg CVEs | **Yes**: KYC thumbnails decode merchant-uploaded JPEG/PNG with sharp | Upgrade to `sharp@0.35.5` (0.x minor = breaking per npm), rebuild, run `kycThumbnail.test.ts` + KYC route tests. Until then, upload is already limited to magic-byte-checked JPEG/PNG/PDF, 8 MB. |
| `fastify` ^5.12.3 (api) | Moderate | DoS via HTTP/2 trailers; header-schema bypass with case-sensitive `propertyNames` | No: we run HTTP/1.1 and use no `propertyNames` header schemas | Patch upgrade to `5.12.6` at the next image rebuild (same major, low risk). |
| `fast-uri` (via fastify/ajv) | Moderate | URI normalisation / scheme confusion | Low: only used inside schema validation | Comes with the fastify patch upgrade. |
| `react-router-dom` ^6.28 (web, admin) | Moderate | Open redirect via backslash in `<Link>` / `useNavigate`; SSR hydration | Partly: client-side only, no SSR | Frontend owner: upgrade to `7.18.x` (major) as a planned task, not in a hurry. |

## Secrets in the repo (D4)

Searched all history (`git log --all -p -G '(SECRET|TOKEN|PASSWORD|_KEY)[A-Z_]*='`, `-S acqsec_`).
One real secret: `ACQUIRER_CALLBACK_SIGNING_SECRET=acqsec_sandbox_f8c3…f602` in `ops/.env.docker`,
commit `669af52` (the file said it was git-ignored; it wasn't). History can't be rewritten, so:

1. Production now **refuses** that value (and the dev / `change-me` values) at boot.
2. **Rotate it** with the acquirer — steps in `docs/bugs/SEC-4-leaked-secret-refused.md`.
3. `.gitignore` now ignores `.env.*` (except the example and the labelled laptop file).
