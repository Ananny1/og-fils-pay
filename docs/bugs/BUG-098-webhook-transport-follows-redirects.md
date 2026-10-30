# BUG-098 — Webhook sender follows redirects (SSRF via test-send)

| | |
|---|---|
| **Severity** | High (security) |
| **Area** | Webhooks / Security |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/webhooks/transport.ts:40` (`fetch(req.url, {...})` with no `redirect` option) at 8b58b0f.

## Summary

- **What's wrong:** a merchant can make the FilsPay API call an internal address and read the answer.
- **Why:** `createFetchTransport` uses `fetch` with its default `redirect: "follow"`. The URL checks in `create.ts` (https in production) only see the first URL; a receiver that answers `307 Location: http://settlement:8091/...` sends our POST there.
- **What it breaks:** `POST .../webhook-endpoints/:id/test` returns up to 2 KB of that internal response to the merchant; real deliveries also hit the internal host. Comments "create.ts blocks private IPs, SSRF is handled upstream" are false (create.ts checks only the scheme).

## Root cause

```ts
// apps/api/src/webhooks/transport.ts
const response = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body, signal: controller.signal });
```

## Fix

`redirect: "manual"` on the fetch. A 3xx is returned as-is (status 307 etc.), which the dispatcher
already treats as a failed attempt and test-send reports to the merchant.

## Options

| Rank | Option | Chosen? |
|---|---|---|
| 1 | Don't follow redirects (`redirect: "manual"`) | ✅ one line, closes the redirect path |
| 2 | Follow redirects but re-validate each hop's host/IP | more code; DNS rebinding still open |
| 3 | Egress proxy that blocks private ranges | best long-term, infrastructure work |

Still open (not this bug): no private-IP / internal-hostname block on the first URL itself.

## Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-098: a redirecting receiver is reported as its 3xx, the redirect target is never called` | `apps/api/src/webhooks/transportRedirect.new.test.ts` | ❌ fails: "the internal address must not be called" (it was called) | ✅ passes |

```bash
cd apps/api && npx tsx --test --test-concurrency=1 src/webhooks/*.test.ts src/routes/webhooks.test.ts   # 73 pass
```
