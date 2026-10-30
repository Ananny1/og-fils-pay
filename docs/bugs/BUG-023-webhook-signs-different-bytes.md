# BUG-023 — Outbound webhook signs different bytes than it sends

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Webhooks · Security |
| **Analysis ID** | W1 (FP-240, Yousif's unmerged `ya/sign-raw`) |
| **Clue** | `docs/HANDOVER.md` "The dispatcher should sign exactly the bytes it sends"; `docs/RUNBOOK.md` MK note "FP-240" |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** every webhook we send carries a signature that does not match the body we send.
- **Why:** we sign one text (`canonicalJson(payload)`, keys sorted A-Z) but send another text (`JSON.stringify(row.payload)`, keys in Postgres jsonb order). Same data, different bytes, so a different HMAC.
- **What it breaks:** a merchant who checks the signature the normal way (HMAC over the raw body) rejects every real event, or turns the check off. With the check off, anyone can send fake "payment captured" events to the merchant.

## 1. The issue

A merchant receiver computes `HMAC(secret, t + "." + rawBody)` and compares it with `v1=` in `X-FilsPay-Signature`. It never matches. Reproduce: run the dispatcher with a fake transport and HMAC `req.body` exactly as received (new assertion in `dispatcher.test.ts`).

## 2. Why it happened — the root cause

`apps/api/src/webhooks/dispatcher.ts` (send path, before):

```ts
const { signature } = signPayload(row.payload, secret);   // signs canonicalJson(payload)
...
body: JSON.stringify(row.payload),                         // sends jsonb key order
```

`row.payload` comes back from a `jsonb` column, whose key order is "shorter key first" (`id, data, type, createdAt`), while `canonicalJson` sorts A-Z (`createdAt, data, id, type`). The same split existed in `webhooks/testSend.ts` (the "send test event" button), though there the object order happened to differ too.

**Traps that hid it:**

| Where | Claim | Truth |
|---|---|---|
| `dispatcher.test.ts` FH comment above the happy-path test | "it verifies the signature end-to-end, so signing is proven correct" | The test re-parses and re-sorts the body before verifying, so it can never see a byte mismatch. With a raw-bytes check the test fails. |
| `docs/RUNBOOK.md` "If a merchant reports that signatures don't verify, ask them to parse the body and re-serialise it with sorted keys" | Presented as the support answer | It is a workaround for this bug that pushes our bug onto every merchant; MK's note under it ("that's on us. FP-240") is right. |

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Signature check fails on every event; they either drop events (orders not marked paid) or disable verification | High: forged webhooks become possible |
| Customers | Paid orders stay "unpaid" at the shop | Medium |
| FilsPay | Support load, "your webhooks are broken", security exposure | High |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/webhooks/sign.ts` | New `signRawBody(rawBody, secret, timestamp)`: signs `${t}.${rawBody}`. `signPayload` now just calls it with `canonicalJson(payload)` (same output as before). |
| `apps/api/src/webhooks/dispatcher.ts` | Serialize once: `const body = canonicalJson(row.payload)`, sign `body` with `signRawBody`, send `body`. |
| `apps/api/src/webhooks/testSend.ts` | Same "serialize once, sign, send the same string" for the test-send button. |

```ts
// after (dispatcher.ts)
const body = canonicalJson(row.payload);
const { signature } = signRawBody(body, secret);
...
body,
```

The body sent is now the canonical (sorted-key) JSON, so it is **both** raw-verifiable and still verifiable by merchants who followed the old runbook advice (re-sort then HMAC) — no merchant breaks. `verifySignature` keeps working unchanged.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Serialize once with `canonicalJson`, sign and send that exact string (`signRawBody`) | Raw bytes verify; old "re-sort" receivers still verify; tiny change | Body key order changes (JSON order has no meaning, so harmless) | ✅ |
| 2 | Keep `JSON.stringify(row.payload)` as the body and sign that string | Also raw-verifiable | Breaks merchants who used the runbook's re-sort workaround | |
| 3 | Store the exact serialized body as `text` in `webhook_deliveries` at creation and replay those bytes forever | Bytes fixed for all retries/replays | Needs a migration and changes to replay paths; more risk in a 4-hour sprint | |
| 4 (creative) | Send a `v2=` signature over raw bytes next to the old `v1=` | Lets merchants migrate gradually | Two schemes to support; `v1` stays broken for raw receivers | |
| 5 | Only fix the runbook text | No code change | Leaves the bug; every merchant must work around it | |

**Why we chose #1:** it removes the root cause (two different serializations) with three small edits and keeps every existing receiver working.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `one active endpoint, 2xx response ... signature verifies` (new raw-body HMAC assertion) | `apps/api/src/webhooks/dispatcher.test.ts` | ❌ fails: expected `eeff0f…`, got `5a13d8…` | ✅ passes |
| `test send signature` (new raw-body HMAC assertion) | `apps/api/src/webhooks/testSend.test.ts` | ❌ fails: expected `d3dd3a…`, got `cacd2d…` | ✅ passes |
| All `sign.test.ts`, `routes/webhooks.test.ts` | | ✅ | ✅ (31/32 webhook tests pass; the 1 red is the known BUG-060 backoff test) |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -T -e DATABASE_URL=... api \
  npx tsx --test apps/api/src/webhooks/dispatcher.test.ts apps/api/src/webhooks/testSend.test.ts
```

Existing tests changed (and why): the two tests above only gained an extra assertion (HMAC over the raw body, the way a real receiver checks). Nothing was removed.
