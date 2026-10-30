# BUG-063 — Card numbers, expiry and CVV were never checked

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Security · Checkout |
| **Analysis ID** | — (found by the team testing checkout, 2026-10-30) |
| **Clue** | "The system should know Visa from Mastercard and reject a mistyped number" |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-063` |
| **Owner** | Ebrahim |
| **Evidence** | route test + unit tests below |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** a card number with a typo, a card brand we don't take, a past expiry or a 1-digit CVV all went straight to the acquirer.
- **Why:** both card routes only checked that a `card` object was present; the brand badge on the page was cosmetic and got the Mastercard range wrong.
- **What it breaks:** customers get a confusing "declined" instead of "check your card number", and garbage card data reaches the acquirer.

## 1. The issue — what was wrong

On `/pay/<token>`, typing `4242 4242 4242 4241` (last digit wrong) showed a **VISA** badge and the payment was sent. A single `4` was shown as Visa. `2720…` (a real Mastercard) showed no badge, `2220…` (not Mastercard) showed **MASTERCARD**. Amex numbers were accepted although FilsPay takes only Visa and Mastercard. Calling the API directly, any string worked as `pan`, `cvv`, month or year.

## 2. Why it happened — the root cause

`apps/api/src/routes/paymentLinks.ts:158` and `apps/api/src/routes/transactions.ts:72`:

```ts
// before
if (!card) {
  throw new BadRequestError("invalid_request", "card is required");
}
```

No Luhn check, no length check, no brand check, no expiry or CVV check. On the page, `formatCardBrandHint` (`apps/web/src/utils/helpers.ts`) tested Mastercard on three digits:

```ts
/^2(2[2-9]|[3-6]\d|7[01])/   // matches 2220 (wrong), misses 2720 (right)
```

Its comment said "cosmetic only … the simulated acquirer accepts any PAN shape", which was true, and that is exactly the gap.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | A typo looks like "card declined"; no hint what to fix | Medium |
| Merchants | Lost sales from confused customers; attempts on brands we can't take | Low |
| FilsPay (finance / ops) | Junk requests reach the acquirer and the transaction log | Low |
| Acquirer / card scheme | Gets numbers that fail Luhn, which a real acquirer counts against us | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/acquirer/cardCheck.ts` (new) | `checkCard()`: Visa (4) or Mastercard (51–55, 2221–2720 on 4 digits) → length for the brand (Visa 13/16/19, MC 16) → Luhn → month 1–12, year sane, not past the end of the expiry month in Bahrain time → CVV 3 digits |
| `apps/api/src/routes/paymentLinks.ts`, `routes/transactions.ts` | Call `checkCard` before anything else; a problem returns `400` with `invalid_card_number` / `unsupported_card_brand` / `invalid_expiry` / `card_expired` / `invalid_cvv` |
| `apps/web/src/utils/helpers.ts` | Mastercard range fixed, Amex dropped, `isValidCardNumber()` with the same rule |
| `apps/web/src/pages/checkout/CheckoutPage.tsx` | Checks the number before sending; maps the five 400 codes to clear messages; test cards listed in full (an ending alone no longer passes) |
| `apps/web/src/i18n/checkout.ts` | The five messages in English and Arabic |

The server check is the real protection; the page check only saves a round trip and gives the message sooner. The decline test cards (`…0002`, `…0119`, `…0069`) and `4242…` are all Luhn-valid, so every demo and the load test keep working.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Check in both card routes, same rule mirrored on the page | Covers the API and the page; small; clear codes | Rule exists twice (API + web) | ✅ |
| 2 | Check inside the acquirer simulator | One place | Simulator stands in for a real acquirer; a real one would be replaced and the check lost | |
| 3 | New shared package for the rule | One copy of the code | New workspace package and build wiring on deadline day | |

**Why we chose #1:** it blocks bad data at the edge of our own API, where it belongs, with the least new structure.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| Luhn, length, brand, MC 2221–2720 edges, Amex refused, expiry (incl. Bahrain month end), CVV | `apps/api/src/acquirer/cardCheck.test.ts` | ❌ no such check | ✅ 7/7 |
| `BUG-063: a mistyped or unsupported card is refused with 400 before any charge, and the link stays payable` | `apps/api/src/routes/paymentLinks.test.ts` | ❌ 200/402 instead of 400 | ✅ passes |
| Brand range and `isValidCardNumber` | `apps/web/src/utils/helpers.test.ts` | ❌ 2220 = mastercard, 2720 = unknown | ✅ passes |

```bash
cd apps/api && npm test        # 598/598
cd apps/web && npm test        # 30/30
```

Existing tests changed (and why): none.
