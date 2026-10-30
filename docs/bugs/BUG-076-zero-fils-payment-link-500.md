# BUG-076 — Creating a payment link for 0 fils crashes with a 500

| | |
|---|---|
| **Severity** | Low |
| **Area** | Money (input handling) |
| **Analysis ID** | — (bug hunt, merchant money paths) |
| **Clue** | `create.ts` header: "never an unguarded `toFils()` RangeError escaping into a 500" |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-076` |
| **Owner** | Sayed |
| **Evidence** | — |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/paymentLinks/create.ts:38` at 8b58b0f.

## Summary (the short note)

- **What's wrong:** `POST /v1/merchants/:id/payment-links` with `amountFils: 0` answers `500 internal_error`.
- **Why:** `toFils(0)` is valid, so the code goes on to the INSERT, which fails `payment_links.amount_fils CHECK (amount_fils > 0)`.
- **What it breaks:** A merchant who mistypes the amount gets "server error" instead of "amount must be positive"; the 500 is logged as a server fault.

## 1. The issue — what was wrong

Merchant creates a link with amount 0 (dashboard or API) → `500 {"error":"internal_error"}`. Negative and decimal amounts already got `400 invalid_amount`; only 0 slipped through.

## 2. Why it happened — the root cause

`apps/api/src/paymentLinks/create.ts:38` (before):

```ts
try {
  amountFils = toFils(input.amountFils);   // 0 is a valid Fils
} catch (err) {
  throw new BadRequestError("invalid_amount", ...);
}
// ... INSERT ... amount_fils = 0  -> 23514 check_violation -> 500
```

The file's own header promises every validation failure is an `AppError`; the "must be > 0" rule existed only in the database.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | — | — |
| Merchants | 500 on a simple typo | Low |
| FilsPay (finance / ops) | False server errors in the log | Low |
| Acquirer / card scheme | — | — |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/paymentLinks/create.ts` | after `toFils`, `amountFils <= 0` → `400 invalid_amount` |

```ts
if (amountFils <= 0) {
  throw new BadRequestError("invalid_amount", "amountFils must be a positive whole number of fils");
}
```

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Check `> 0` next to the existing `toFils` check | 3 lines, same error code as today | — | ✅ |
| 2 | Map Postgres 23514 to 400 in the error handler | Covers every CHECK | A CHECK failing from server logic is a real server bug and would be hidden as 400 | |
| 3 | JSON schema `minimum: 1` on the route | Declarative | New pattern in this route file | |

**Why we chose #1:** smallest, keeps the error the merchant already sees for other bad amounts.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-076: a 0-fils payment link is rejected with 400 invalid_amount` | `apps/api/src/paymentLinks/createAmount.new.test.ts` | ❌ pg `payment_links_amount_fils_check` error (500) | ✅ |

```bash
cd apps/api && npx tsx --test src/paymentLinks/createAmount.new.test.ts
```

Existing tests changed: none.
