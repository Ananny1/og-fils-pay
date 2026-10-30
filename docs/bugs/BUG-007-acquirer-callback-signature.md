# BUG-007 — Acquirer callback signature is optional, checked over the wrong bytes, never expires, and `outcome` is not checked

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Security (webhooks / inbound auth) |
| **Analysis ID** | W3, W4, W5 |
| **Clue** | `app.ts` comment "inboundVerify rejects unsigned requests, so OK"; route doc "`outcome` is validated"; test "accepts a callback sent without a signature header" |
| **Owner** | Ebrahim (stream S3) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** Anyone on the internet can post a fake "fraud review" result to `POST /v1/acquirer/callbacks`. If they leave out the signature header, it is accepted.
- **Why:** The verifier returns "valid" when there is no header, unless an env flag (`ACQUIRER_CALLBACK_REQUIRE_SIGNATURE`, default `false`) is set. When there is a header, it signs `JSON.stringify(parsed body)` (not the bytes sent), never checks the timestamp, and the route stores any `outcome` text.
- **What it breaks:** A forger can mark any transaction "confirmed_fraud" (or "cleared") on the timeline that support and finance read, so real fraud can be waved through or a good merchant's payments voided. A captured genuine callback can be replayed forever. A real acquirer callback with different spacing or key order fails.

## 1. The issue

Before the fix, with the test app (secret configured):

```
POST /v1/acquirer/callbacks   (no Acquirer-Callback-Signature header)      -> 200, note stored
POST /v1/acquirer/callbacks   (genuine signature, timestamp 1 hour old)    -> 200, note stored
POST /v1/acquirer/callbacks   (outcome "approved", signed)                 -> 200, note stored
POST /v1/acquirer/callbacks   (genuine signature over the raw bytes, but
                               spacing differs from JSON.stringify)        -> 401 signature_mismatch
```

## 2. Why it happened

`apps/api/src/webhooks/inboundVerify.ts` (before):

```ts
if (!header) {
  return requireSignature ? { valid: false, reason: "malformed_header" } : { valid: true };
}
...
.update(`${parsed.timestamp}.${JSON.stringify(payload)}`)   // parsed object, not the raw body
// "freshness is not checked for inbound callbacks"
Buffer.compare(...)                                         // not a constant-time compare
```

`routes/acquirerCallbacks.ts` passed `app.config.acquirerCallbackRequireSignature` (env default
`false`) and cast `body.outcome as AcquirerCallbackInput["outcome"]` with no check.

False claims that hid it (trap protocol):

| Where | Claim | Truth |
|---|---|---|
| `apps/api/src/app.ts:71` (FH) | "inboundVerify rejects unsigned requests, so OK" | It accepted them unless an env flag was set (default false) |
| `routes/acquirerCallbacks.ts` doc on `AcquirerCallbackBody` | "`outcome` is validated against the union (`approved` / `rejected`) ... any other value is a 400" | No check at all, and the real union is `cleared` / `confirmed_fraud` |
| `acquirer/callbacks.ts` `@property outcome` | "Validated ... by the route schema" | There is no route schema |
| `routes/acquirerCallbacks.test.ts` (MK) | "dev-mode behaviour (empty secret). prod rejects" | The test app has a secret, and prod did not reject either |
| `config.ts` | "Set true once the sandbox signs everything" | Nobody ever set it; no env file or compose sets it |

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Forged "confirmed_fraud" notes can get their real payments voided or refunded | High |
| Cardholders | Forged "cleared" notes hide real fraud from support | High |
| FilsPay (risk / support / finance) | The transaction timeline is not trustworthy; replayed callbacks pile up | Critical |
| Acquirer | Their real callbacks fail if their JSON spacing/order differs from ours | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/webhooks/inboundVerify.ts` | Signature always required (`missing_header`); empty secret rejects all (`secret_not_configured`); HMAC over `${t}.${rawBody}`; constant-time `timingSafeEqualHex`; 300 s freshness window (`timestamp_out_of_tolerance`), same as outbound `verifySignature` |
| `apps/api/src/routes/acquirerCallbacks.ts` | JSON parser scoped to this plugin keeps the raw request text for the HMAC; `outcome` must be `cleared` or `confirmed_fraud` (else 400); no optional flag passed; doc comment corrected |
| `apps/api/src/config.ts` | Removed `acquirerCallbackRequireSignature` (the off switch) |
| `apps/api/src/app.ts`, `acquirer/callbacks.ts` | False comments corrected |
| `docs/ARCHITECTURE.md` | Env table: removed `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE`, documented the secret |

The parser change is registered inside `acquirerCallbackRoutes`, so Fastify's encapsulation keeps it
to this one route; every other route keeps the default JSON parser.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Always require the signature, verify over the raw bytes, add a 300 s timestamp window, constant-time compare, whitelist `outcome` | Closes all three holes (W3–W5) in the two files that own them; same scheme as our outbound signing | Callbacks fail if the acquirer's clock drifts > 5 min (that is the point) | ✅ |
| 2 | Keep the code, set `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE=true` in prod env | No code change | Fails open again the day the env is missed; still re-serialised, no freshness, no outcome check | |
| 3 | Re-sign with `canonicalJson(parsed)` instead of raw bytes | No parser change | Still not what the acquirer signed (numbers, unicode escapes, duplicate keys can differ) | |
| 4 (creative) | Replay protection with a nonce table of seen `(t, v1)` pairs, on top of the time window | Blocks replays even inside the 5-minute window | New table and cleanup job; BUG-006's unique `callback_id` already makes an in-window replay a no-op | |

**Why we chose #1:** it removes the root cause (an optional, wrong-input check) with the smallest
change, and BUG-006 covers the in-window replay case.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| rejects a callback sent without a signature header | `apps/api/src/routes/acquirerCallbacks.test.ts` | ❌ 200 | ✅ 401 `missing_header` |
| rejects a genuine but stale (replayed) callback | same | ❌ 200 | ✅ 401 `timestamp_out_of_tolerance` |
| verifies the raw bytes the acquirer signed | same | ❌ 401 | ✅ 200 |
| rejects an outcome outside cleared / confirmed_fraud | same | ❌ 200 | ✅ 400 |
| an unsigned callback is rejected / no secret rejects all / raw bytes / stale | `apps/api/src/webhooks/inboundVerify.test.ts` | ❌ 5 of 8 fail | ✅ 8 of 8 |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -T -e DATABASE_URL=... api \
  npx tsx --test apps/api/src/routes/acquirerCallbacks.test.ts apps/api/src/webhooks/inboundVerify.test.ts
# 20 pass, 0 fail (with acquirer/callbacks.test.ts); tsc --noEmit -p apps/api clean
```

Existing tests changed (and why):
- "accepts a callback sent without a signature header" asserted the bug (200). Now it asserts 401.
- "an unsigned callback is accepted while signature checking is optional" (unit) asserted the bug. Now it asserts `missing_header`.
- Unit tests now pass the raw body string (the new input), and the route helper signs with the current time (a fixed 2025 timestamp is now stale).
