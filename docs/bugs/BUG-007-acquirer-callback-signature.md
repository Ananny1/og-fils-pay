# BUG-007 — Acquirer callback signature is optional, replayable and checked over the wrong bytes

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Security · Webhooks (inbound) |
| **Analysis ID** | W3, W4 |
| **Clue** | `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE` default `false` (ARCHITECTURE.md); route comment "outcome is validated" |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

`POST /v1/acquirer/callbacks` is public; the HMAC header is its **only** authentication.
Anyone on the internet could post a fraud verdict for any transaction id by simply leaving the
header out. A real signed callback could be captured and replayed forever. A real acquirer that
signs its exact bytes (any key order/whitespace other than `JSON.stringify`) was rejected. Any
`outcome` string was stored.

## 2. Why it happened — the root cause

`apps/api/src/webhooks/inboundVerify.ts` (before):

```ts
if (!header) {
  return requireSignature ? { valid: false, ... } : { valid: true };   // flag defaults to false
}
.update(`${parsed.timestamp}.${JSON.stringify(payload)}`)               // re-serialised, not raw bytes
Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0                    // not constant-time
/** There is no timestamp reason: freshness is not checked */          // replay forever
```

`apps/api/src/routes/acquirerCallbacks.ts` cast `body.outcome as AcquirerCallbackInput["outcome"]`
without checking it; its comment claims a check against `"approved" | "rejected"` (wrong values,
and no check exists). The signature was also checked *after* the body was validated, so an
unauthenticated caller learnt about the expected fields.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Forged "confirmed_fraud" notes on their transactions → wrong voids/refunds by staff | High |
| FilsPay (risk / support) | Timeline cannot be trusted | High |
| Acquirer | Correctly signed callbacks with non-JSON.stringify formatting rejected | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/webhooks/inboundVerify.ts` | Takes the raw body string; missing header / empty secret → invalid; `timingSafeEqualHex`; 300 s timestamp tolerance (same as outbound `verifySignature`) |
| `apps/api/src/routes/acquirerCallbacks.ts` | Plugin-scoped JSON parser keeps `rawBody`; verify **first**; 400 on `outcome` ∉ {cleared, confirmed_fraud} or unparsable `occurredAt` |

The `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE` flag is no longer read (left in `config.ts` to avoid
touching shared config; can be deleted).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Always require; raw bytes; constant-time; tolerance | Closes every hole; mirrors outbound `sign.ts` | Acquirer sandbox must sign (it has a secret already) | ✅ |
| 2 | Flip the flag default to `true` | One-line | Still opt-out by env; replay + raw-bytes holes stay | |
| 3 | IP allow-list the acquirer | Defence in depth | Infra-only, doesn't fix verification | (later) |

## 6. Proof — tests

| Test | File | Before | After |
|---|---|---|---|
| unsigned → 401 with flag unset | `apps/api/src/routes/acquirerCallbacks.new.test.ts` | ❌ 200 | ✅ |
| reordered/pretty JSON signed over raw bytes → 200 | same | ❌ 401 | ✅ |
| stale timestamp → 401 | same | ❌ 200 | ✅ |
| `outcome: "approved"` → 400 | same | ❌ 200 | ✅ |

```bash
cd apps/api && npx tsx --test src/routes/acquirerCallbacks*.test.ts src/webhooks/inboundVerify.test.ts
```

Existing tests changed (they encoded the bug): `routes/acquirerCallbacks.test.ts` — signs with
the current time (old fixed 2025 timestamp is now stale), the missing-fields test is signed (auth
comes first), "accepts unsigned" → "rejects unsigned". `webhooks/inboundVerify.test.ts` — passes
raw strings, current timestamp, "unsigned accepted" → "unsigned rejected".
