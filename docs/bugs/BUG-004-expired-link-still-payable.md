# BUG-004 — Expired payment link can still be paid

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Money · Security (checkout) |
| **Analysis ID** | P1 (see `docs/challenge/ANALYSIS.md`) |
| **Clue** | FP-187; migration 0020 trailing comment "pay also accepts the terminal's clientNow" |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-004` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

A merchant sets an expiry on a payment link ("pay by 18:00"). After that time the link page shows
"expired", but anyone could still pay it: they only had to send an old `submittedAt` time in the pay
request body. The server then judged expiry by that time, not by its own clock.

Reproduce: create a link, move `expires_at` into the past, then
`POST /v1/payment-links/:token/pay` with `{"card": {...}, "submittedAt": "<yesterday>"}` → **200
paid** (should be 410).

## 2. Why it happened — the root cause

The public, unauthenticated route passed the body's `submittedAt` straight into the business logic,
and the logic used it as "now" for the expiry check.

```ts
// apps/api/src/routes/paymentLinks.ts (before)
const { card, submittedAt } = request.body ?? {};
... payPaymentLink(..., { token, card, idempotencyKey, submittedAt });

// apps/api/src/paymentLinks/pay.ts (before)
export function expiryReferenceTime(submittedAt?: string): Date {
  if (!submittedAt) return new Date();
  const parsed = new Date(submittedAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;   // payer chooses the clock
}
const expiryCheckTime = expiryReferenceTime(input.submittedAt);
... AND expires_at > $3   -- $3 = expiryCheckTime
```

False claims that hid it:
- The route's doc comment said `submittedAt` is "ignored unless the request is authenticated with an
  API key". The route has no authentication at all and never checked for one.
- `pay.test.ts` had a test "a valid ISO-8601 string round-trips exactly" marked "offline-terminal
  contract test. MK said don't delete". It locked the bug in.
- The web checkout (`CheckoutPage.tsx`) sent `submittedAt` on every pay, so nobody noticed.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Could pay a stale invoice / price the merchant had withdrawn | Medium |
| Merchants | Lose control of offer windows; get paid for links they consider dead (e.g. a deposit for a date that has passed) | High |
| FilsPay (finance / ops) | Disputes and refunds for payments that should not exist | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/paymentLinks/pay.ts` | `expiryReferenceTime()` always returns the server clock; `submittedAt` removed from `PayPaymentLinkInput` |
| `apps/api/src/routes/paymentLinks.ts` | public pay route no longer reads or forwards `submittedAt` |
| `apps/web/src/api/paymentLinks.ts`, `apps/web/src/pages/checkout/CheckoutPage.tsx` | checkout stops sending `submittedAt` |

```ts
// after
export function expiryReferenceTime(_clientTime?: string): Date {
  return new Date();
}
const expiryCheckTime = expiryReferenceTime();
```

Smallest correct change: the claim `UPDATE ... AND expires_at > $3` is already atomic; only the value
of `$3` was wrong. Using the server clock removes the root cause (client-controlled time) rather than
trying to validate the client value.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Server clock only; drop `submittedAt` from the public route | Simple, no trust in the client | An offline terminal can't "pre-date" a payment (it must not be able to) | ✅ |
| 2 | Accept `submittedAt` only within ±N seconds of server time | Tolerates clock skew | Still lets a payer stretch expiry by N seconds; more code | |
| 3 | Accept `submittedAt` only for API-key authenticated callers (what the comment claimed) | Matches the doc | The route is public; would need a new authenticated route; out of scope | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-004: an expired link cannot be paid by sending an old submittedAt` | `apps/api/src/paymentLinks/pay.new.test.ts` | ❌ 200 (paid) | ✅ 410 `payment_link_expired`, no transaction |

```bash
DATABASE_URL=... npx tsx --test apps/api/src/paymentLinks/pay.new.test.ts
```

Existing tests changed:
- `apps/api/src/paymentLinks/pay.test.ts`: "a valid ISO-8601 string round-trips exactly" asserted the
  bug (client chooses the clock). Replaced by "a valid client ISO-8601 string is ignored -> the
  server's own clock".
- `apps/api/src/routes/paymentLinks.test.ts`: removed the misleading comment "with a past submittedAt
  it pays — that's the terminal case".
