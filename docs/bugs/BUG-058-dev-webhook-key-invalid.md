# BUG-058 — The API's built-in development key is invalid, so the API and seed crash in dev

| | |
|---|---|
| **Severity** | High (blocks every fresh local run) |
| **Area** | Deploy / config |
| **Analysis ID** | — (found while reproducing DEP-004) |
| **Clue** | compose: "the api uses a built-in dev key unless NODE_ENV=production (copilot, pasted by FH — unverified)"; ops/README MK: "the api won't boot without WEBHOOK_SECRET_ENCRYPTION_KEY in any environment" |
| **Evidence** | S1 "Run `docker compose up` in `ops/` to start everything on your laptop" |
| **Decision** | D-003 |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** On a laptop without a hand-made webhook key, the API and the seed job crash at start.
- **Why:** The built-in dev key in `apps/api/src/config.ts` decodes to 34 bytes; the same file requires exactly 32.
- **What it breaks:** The organisers' "run `docker compose up` in `ops/`" fails on a fresh clone; nobody can run the app without first finding and fixing a secret.

## 1. The issue

Fresh clone, no `ops/.env.docker`, `cd ops && docker compose up`:

```
api-1   | Error: loadConfig: WEBHOOK_SECRET_ENCRYPTION_KEY must base64-decode to exactly 32 bytes, got 34
seed-1  | Error: loadConfig: WEBHOOK_SECRET_ENCRYPTION_KEY must base64-decode to exactly 32 bytes, got 34
```

The same happens with `npm run dev` in `apps/api` and with any script that loads the API config
(the seed imports it) whenever no key is set.

## 2. Why it happened

`apps/api/src/config.ts`:

```ts
const DEV_FALLBACK_WEBHOOK_KEY_B64 = "dGVzdC1rZXktZm9yLWRldi1vbmx5LW5vdC1mb3ItcHJvZA==";
// → "test-key-for-dev-only-not-for-prod" = 34 bytes
...
webhookSecretEncryptionKey: parseWebhookSecretEncryptionKey(
  env.WEBHOOK_SECRET_ENCRYPTION_KEY || (nodeEnv !== "production" ? DEV_FALLBACK_WEBHOOK_KEY_B64 : undefined),
),
```

`parseWebhookSecretEncryptionKey` (same file) requires exactly 32 decoded bytes (AES-256-GCM key), so
the fallback can never pass its own check. It went unnoticed because **every existing test passes an
explicit key** (`WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcY…"` in `app.test.ts`, `passwords.test.ts`, …),
so the fallback path was never executed. Trap T-42: the compose comment says the dev key works; it was
pasted from an assistant and never checked.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| FilsPay engineers / new joiners | Can't start the API or seed locally without inventing a 32-byte key | High |
| Judges / organisers | The brief's "docker compose up in ops/" fails | High |
| Merchants, customers | Not directly (production must set a real key and still does) | — |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/config.ts` | `DEV_FALLBACK_WEBHOOK_KEY_B64` replaced by base64 of `"dev-only-webhook-key-not-for-prd"` (exactly 32 bytes), with a comment saying so. |
| `apps/api/src/config.test.ts` | New: dev without a key boots with a 32-byte key; unset `NODE_ENV` too; production without a key still throws. |

One constant. Production behaviour is unchanged: there the fallback is never used and a missing key
still stops the boot.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Replace the constant with a valid 32-byte dev-only key | One line; restores what the code clearly intended; prod unchanged | A dev key is in the source (it already was, and is labelled dev-only) | ✅ |
| 2 | Relax the check to accept any length in dev | No new constant | Weakens validation; AES-256-GCM needs 32 bytes, so encryption would fail later at first delivery instead | |
| 3 | Remove the fallback, require the key everywhere | No key in source | Breaks `npm run dev` and the brief's one-command start; every dev must generate a key first | |
| 4 | Generate a random dev key at boot | No fixed key | Encrypted webhook secrets become unreadable after every restart | |

## 6. Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| development boots without WEBHOOK_SECRET_ENCRYPTION_KEY, using a valid 32-byte dev key | `apps/api/src/config.test.ts` | ❌ "got 34" | ✅ |
| an unset NODE_ENV is development and also boots without a key | same | ❌ "got 34" | ✅ |
| production still refuses to boot without a real key | same | ✅ | ✅ |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -v "$PWD/apps/api/src:/app/apps/api/src" api \
  npx tsx --test apps/api/src/config.test.ts        # 3/3 pass
# apps/api: npx tsc --noEmit → no errors
```

Real boot, dev mode, no key: before → `got 34`; after → `booted, key bytes: 32`.
The full API suite runs in T1 (baseline) right after DEP-004.

Existing tests changed: none.
