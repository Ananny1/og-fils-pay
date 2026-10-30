# SEC-4 — The acquirer secret leaked in git history was still accepted (D4)

| | |
|---|---|
| **Severity** | High |
| **Area** | Security (Integrity: fake acquirer callbacks) |
| **Analysis ID** | D4 (`docs/challenge/ANALYSIS.md` §3.8) |
| **Clue** | `ops/.env.docker` in the reference history: "safe to keep … not a production credential … gitignored" |
| **Decision** | D-016 |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed in code; rotation is an ops step (below) |

## Summary (the short note)

- **What's wrong:** A real acquirer signing secret sits in the repo's git history, and the API would still accept it in production.
- **Why:** `ops/.env.docker` with `ACQUIRER_CALLBACK_SIGNING_SECRET=acqsec_sandbox_f8c3…f602` was committed in `669af52`; `config.ts` only checked that the secret is non-empty.
- **What it breaks:** Anyone with the repo can sign fake "payment captured / refunded" callbacks and the API trusts them.

## 1. The issue

`git show 669af52:ops/.env.docker` prints the acquirer secret. The file comment claims it is
git-ignored ("`.env` matches `.env.docker` as a prefix" — false, T-trap) and "not a production
credential". It was the value the stack ran with. History cannot be rewritten for the submission,
so the value is public forever.

The same check also accepted other public values in production: the `change-me` placeholders in
`ops/.env.docker.example`, and the laptop values in `ops/.env.dev` (which compose loads first, so a
hosted `.env.docker` that forgets a key silently inherits the dev one).

Search used: `git log --all -p -G '(SECRET|TOKEN|PASSWORD|_KEY)[A-Z_]*='` and `-S acqsec_`. Only
this one real secret was found; every other hit is a test value, a `change-me` placeholder or a
labelled dev value.

## 2. Why it happened

```ts
// apps/api/src/config.ts (before)
const acquirerCallbackSigningSecret = env.ACQUIRER_CALLBACK_SIGNING_SECRET ?? "";
if (nodeEnv === "production" && acquirerCallbackSigningSecret === "") { throw ... }
```

Non-empty was the only rule. Trap: "safe to keep … gitignored" (the `.gitignore` had only `.env`).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Forged callbacks could mark payments captured/failed or fake refunds | High |
| FilsPay finance | Ledger and settlement built on forged events | High |
| Acquirer | Shared secret compromised | High |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/config.ts` | `KNOWN_PUBLIC_SECRETS` (leaked acquirer secret, `.env.dev` values, dev webhook key, `change-me`) and `refusePublicSecret`: in production, boot fails if `SETTLEMENT_INTERNAL_TOKEN`, `ACQUIRER_CALLBACK_SIGNING_SECRET`, `WEBHOOK_SECRET_ENCRYPTION_KEY` or `KYC_ENCRYPTION_KEY` is one of them. Dev/test unchanged. |
| `apps/api/src/config.test.ts` | New test: every known value refused in production; a real value boots; dev still boots with dev values. |
| `ops/.env.docker.example` | Says placeholders are refused, how to generate values, adds `KYC_ENCRYPTION_KEY`. |

Fail closed: a hosted box still on a public value stops at boot with a clear message instead of
running with a key everyone has.

### Rotation steps (ops, cannot be done in code)

1. Ask the acquirer to issue a new callback signing secret (`openssl rand -hex 32` if we choose it).
2. Put it in the hosted `ops/.env.docker` as `ACQUIRER_CALLBACK_SIGNING_SECRET` (never in git).
3. Set `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE=true` once the acquirer signs everything.
4. Restart the api; confirm a signed test callback is accepted and one signed with the old value gets 401.
5. Ask the acquirer to revoke the old value. Review callbacks received since `669af52` for forgeries.
6. Same check for `SETTLEMENT_INTERNAL_TOKEN` and the webhook/KYC keys: generate fresh ones if the box ever used a dev value.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Deny-list known public values in production + rotate | Small; blocks the leaked value even if someone copies old files back; clear error | List must be kept up to date | ✅ |
| 2 | Rewrite git history (filter-repo) | Removes the text | Not allowed for the submission; forks/clones still have it; does not rotate anything | |
| 3 | Minimum length/entropy rule only | Catches `change-me` | The leaked value is long and random-looking, so it passes | |
| 4 | Rotate only, no code check | No code | Nothing stops the old value coming back | |

**Not done here (follow-up):** the Go settlement service (`apps/settlement/internal/config`) does
not yet refuse the dev settlement token; the api now refuses it, and the two must match, so a
hosted pair on the dev token already fails at the api.

## 6. Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| production refuses public secrets | `apps/api/src/config.test.ts` | ❌ fail | ✅ pass |
| all other config tests | `apps/api/src/config.test.ts` | ✅ | ✅ |
| `tsc --noEmit -p apps/api` | | | clean |
