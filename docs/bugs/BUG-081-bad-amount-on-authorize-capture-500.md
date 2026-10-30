# BUG-081 — A bad amount on authorize or capture crashes with a 500

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Money (input handling) |
| **Analysis ID** | — (bug hunt, merchant money paths) |
| **Clue** | `createPaymentLink` wraps `toFils` for this reason; the transaction routes do not |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-081` |
| **Owner** | Sayed |
| **Evidence** | — |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** `POST /v1/transactions` with `amountFils` 0, negative, 1.5, `"1000"` or `true`, and capture with a negative / decimal / string amount, answer `500 internal_error`.
- **Why:** The routes pass the raw body value to `toFils`, which throws a plain `RangeError`; for authorize, `0` even reaches the acquirer and then fails the `amount_fils > 0` CHECK.
- **What it breaks:** Merchant integrations get a "server crashed" answer for their own mistake and may retry forever; authorize 0 asks the acquirer to approve a charge we then cannot record.

## 1. The issue — what was wrong

```
POST /v1/transactions   {"amountFils": 1.5, "card": {...}}   → 500 {"error":"internal_error"}
POST /v1/transactions   {"amountFils": 0,   "card": {...}}   → acquirer approves, INSERT fails CHECK → 500
POST /v1/transactions/:id/capture  {"amountFils": -100}      → 500
```

## 2. Why it happened — the root cause

`apps/api/src/routes/transactions.ts` (before):

```ts
// authorize, line ~77
if (amountFils === undefined || !card) { ... }      // only "present" was checked
...
amountFils: toFils(amountFils),                       // RangeError on 1.5 / "1000" / -1 → 500

// capture, line ~108
amountFils: amountFils !== undefined ? toFils(amountFils) : undefined,
```

`toFils` throws `RangeError`, which is not an `AppError`, so the error handler turns it into a 500. `toFils(0)` is valid, so authorize calls the acquirer for 0 fils and only then hits `transactions.amount_fils CHECK (amount_fils > 0)` (Postgres 23514, also a 500). `createPaymentLink` and the refund route already validate this; the transaction routes were missed.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | A 0-fils authorization at the acquirer with no FilsPay record | Low |
| Merchants | 500 instead of a clear 400 for a bad request | Medium |
| FilsPay (finance / ops) | Error log filled with false "server errors" | Low |
| Acquirer | Receives 0-fils authorizations | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/transactions.ts` (authorize) | `amountFils` must be a positive safe integer, else `400 invalid_amount`, checked before the card and the acquirer |
| `apps/api/src/routes/transactions.ts` (capture) | if given, `amountFils` must be a non-negative safe integer, else `400 invalid_amount`; `0` still gets capture's own `422 capture_exceeds_remaining` (existing test) |

```ts
if (typeof amountFils !== "number" || !Number.isSafeInteger(amountFils) || amountFils <= 0) {
  throw new BadRequestError("invalid_amount", "amountFils must be a positive whole number of fils");
}
```

Same check and wording as the refund route; no change to the business modules.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Validate in the two routes, like the refund route | Small, local, before any side effect | Two copies of a one-line rule | ✅ |
| 2 | Map every `RangeError` to 400 in the error handler | One place | Hides real server bugs that throw RangeError; authorize 0 still reaches the acquirer | |
| 3 | Fastify JSON schema on the routes | Declarative | New pattern for this file; bigger change | |

**Why we chose #1:** stops the bad value before the acquirer call, matches existing code.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-081: authorize with a bad amountFils is 400 invalid_amount, never 500` | `apps/api/src/routes/transactions.amount.new.test.ts` | ❌ `amountFils=0: {"error":"internal_error"}` | ✅ |
| `BUG-081: capture with a bad amountFils is 400 invalid_amount, never 500` | same | ❌ 500 for -100 / 1.5 / "1000" | ✅ |

```bash
cd apps/api && npx tsx --test src/routes/transactions.amount.new.test.ts
```

Existing tests changed: none.
