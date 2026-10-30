# BUG-099 — Webhook sender reads the receiver's whole reply into memory

| | |
|---|---|
| **Severity** | Medium (availability) |
| **Area** | Webhooks |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/webhooks/transport.ts:48` (`const body = await response.text();`) at 8b58b0f.

## Summary

- **What's wrong:** a merchant's receiver (or anything it redirects to) can answer every delivery and test-send with a huge body, and the API buffers all of it.
- **Why:** `createFetchTransport` calls `response.text()`; the timeout only bounds time, and a fast receiver sends 64 MB in well under the 5 s timeout. Only the first 2000 chars are ever used (`left($4, 2000)`, `slice(0, 2000)`).
- **What it breaks:** memory spikes / OOM of the 512 MB API (it also serves checkout), up to 100 deliveries per pass. The comment "timeoutMs bounds it. fine for now" is false.

## Fix

`readCapped()` reads the body stream up to 16 KB, then cancels it. Callers are unchanged.

## Options

| Rank | Option | Chosen? |
|---|---|---|
| 1 | Stream and stop at a small cap | ✅ |
| 2 | Reject by `Content-Length` | chunked replies have none |
| 3 | Don't read the body at all | loses the excerpt merchants debug with |

## Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-099: only a bounded prefix of a huge receiver response is read` | `apps/api/src/webhooks/transportBodyCap.new.test.ts` | ❌ fails: "read 67108864 chars of a 64 MB response" | ✅ passes |

```bash
cd apps/api && npx tsx --test --test-concurrency=1 src/webhooks/*.test.ts src/routes/webhooks.test.ts   # 74 pass
```
