# BUG-023 — Outbound webhook signatures never match the bytes sent

| | |
|---|---|
| **Severity** | High |
| **Area** | Webhooks (outbound) |
| **Analysis ID** | W1 |
| **Clue** | FP-240; RUNBOOK "ask them to re-serialise with sorted keys"; YA's comment on the dispatcher happy-path test; Yousif's unmerged `ya/sign-raw` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

Merchants verify a webhook by HMAC-ing the raw request body with their secret. That failed for
every delivery and every "send test event", so merchants either turned verification off (accepting
forged webhooks) or rejected genuine ones. Support's workaround told merchants to parse and
re-sort keys — not something standard libraries do.

## 2. Why it happened — the root cause

`apps/api/src/webhooks/dispatcher.ts` (before):

```ts
const { signature } = signPayload(row.payload, secret);   // HMAC over canonicalJson(payload): keys sorted
...
body: JSON.stringify(row.payload),                         // sends jsonb key order
```

`row.payload` comes back from a `jsonb` column, whose key order is "shorter keys first", not
sorted, so the signed string and the sent body differ. `testSend.ts` had the same split
(`canonicalJson(testPayload)` vs `JSON.stringify(testPayload)`). The existing tests could not
catch it: they re-parsed the body and re-canonicalised before verifying (YA's comment says so).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Can't verify any webhook → disable verification or drop events | High |
| Customers | Orders not fulfilled when merchants drop "unverified" capture events | Medium |
| FilsPay | Support load; merchants exposed to forged webhooks | High |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/webhooks/dispatcher.ts` | `const body = JSON.stringify(row.payload)` once; sign `body`; send `body` |
| `apps/api/src/webhooks/testSend.ts` | Same for the test ping |
| `apps/api/src/webhooks/sign.ts` | `signPayload` / `verifySignature`: a string argument is the raw body, signed verbatim; objects still canonicalised |
| `docs/RUNBOOK.md` | Replaced the "re-serialise with sorted keys" advice |

Serialise once, sign and send the same bytes — the mismatch cannot reappear.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Serialise once; sign the exact string sent | Industry standard (Stripe-style); tiny change | — | ✅ |
| 2 | Send `canonicalJson(payload)` as the body | Also consistent | Still relies on two code paths agreeing; leaves receivers guessing | |
| 3 | Document "re-sort keys" for merchants | No code | Wrong; every merchant breaks | |

## 6. Proof — tests

| Test | File | Before | After |
|---|---|---|---|
| dispatched webhook verifies over raw body | `apps/api/src/webhooks/signRawBody.new.test.ts` | ❌ | ✅ |
| test-send verifies over raw body | same | ❌ | ✅ |

```bash
cd apps/api && npx tsx --test src/webhooks/signRawBody.new.test.ts
```

Existing tests changed: `webhooks/dispatcher.test.ts`, `routes/webhooks.test.ts` (2 places),
`webhooks/testSend.test.ts` now verify `req.body` (the raw bytes) instead of a re-parsed object —
the old form is exactly what hid this bug.
