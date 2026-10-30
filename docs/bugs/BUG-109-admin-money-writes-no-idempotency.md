# BUG-109 — Admin credits and balance adjustments can post twice

| | |
|---|---|
| **Severity** | High |
| **Area** | Money |
| **Analysis ID** | — (found in the admin money-write review) |
| **Clue** | CSV adjustment import has a duplicate guard; the single-action routes have none |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-109` |
| **Owner** | Sayed |
| **Evidence** | `apps/api/src/routes/adminMoneyIdempotency.new.test.ts` |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** if a finance admin double-clicks "Issue credit" or "Adjust balance", or the browser
  retries after a lost reply, the money moves twice.
- **Why:** neither route accepts an Idempotency-Key; every POST is a brand-new posting.
- **What it breaks:** merchants get paid a credit twice (FilsPay loses money) or a correction is
  applied twice (wrong payable balance).

## 1. The issue — what was wrong

`POST /v1/admin/merchants/:id/credits` and `POST /v1/admin/merchants/:id/balance-adjustments` had no
way to say "this is the same action as before". Send the same request twice → two credit requests
(two ledger postings under the threshold) or two balance changes. Reproduce: send the same credit
twice; `credit_requests` gets 2 rows and the payable balance doubles.

**Present in the original code:** `apps/api/src/routes/adminCredits.ts:70` and
`apps/api/src/routes/adminBalanceAdjustments.ts:67` at 8b58b0f (and `admin/credits.ts:205`,
`admin/balanceAdjustments.ts:25`, which never look at any key).

## 2. Why it happened — the root cause

```ts
// adminCredits.ts:70 (8b58b0f) — no key, every call creates and may post a credit
const record = await createCreditRequest(app.db, { merchantId, adminUserId, body: request.body });
// adminBalanceAdjustments.ts:67 (8b58b0f) — no key, every call moves the balance
const result = await applyBalanceCorrection(app.db, { merchantId, adminUserId, deltaFils, reason });
```

Merchant capture/refund use `claimIdempotencyKey` (`idempotency_keys` table, migration 0019); the admin
money writes never did, and the admin console sent no key.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | not affected | — |
| Merchants | payable balance wrong (too high or too low after a doubled correction) | Medium |
| FilsPay (finance / ops) | pays a goodwill credit twice; must find and reverse it by hand | High |
| Acquirer / card scheme / partners | not affected | — |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/adminCredits.ts` | `optionalIdempotencyKey()` reads the `Idempotency-Key` header (blank/too long → 400) and passes it on |
| `apps/api/src/routes/adminBalanceAdjustments.ts` | same, for adjustments |
| `apps/api/src/admin/credits.ts` | inside the create transaction, after the merchant check: `claimIdempotencyKey` (endpoint `admin.credits.create:<adminUserId>`, merchant = path merchant, hash of the body); replay → first record; different body → 422 `idempotency_key_reused`; completes the key with the 201 record |
| `apps/api/src/admin/balanceAdjustments.ts` | same in `applyBalanceCorrection`, claimed after the `FOR UPDATE` row lock; hash of `{deltaFils, reason}` |
| `apps/admin/src/api/{credits,balanceAdjustments}.ts` | send `Idempotency-Key` |
| `apps/admin/src/api/idempotency.ts` + `MerchantDetailPage.tsx` | one key per intended action: kept across a retry with no answer, cleared once the server answered (same rule as web `refundIdempotency.ts`) |

**Header is optional.** Without it the routes behave exactly as before, so older scripts/clients keep
working; the admin console always sends one. No migration: the existing `idempotency_keys` table fits
(its `merchant_id` is the target merchant; the admin id is part of `endpoint`, so keys are scoped per
admin + route + merchant). Same claim/complete in the same transaction as the posting, so a failed
posting rolls the claim back too, and concurrent duplicates serialize on the unique index.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Reuse `idempotency_keys` with an optional header | No migration; proven mechanism; old clients keep working | Clients without a key are still unprotected | ✅ |
| 2 | Make the header required | Every call protected | Breaks any existing script calling these routes | |
| 3 | Server-side dedupe on (merchant, amount, reason, minutes) | No client change | Blocks two genuine identical credits; guesswork | |

## 6. Proof

`DATABASE_URL=… npx tsx --test src/routes/adminMoneyIdempotency.new.test.ts` (apps/api)

Before the fix:

```
✖ BUG-109: a credit sent twice with the same Idempotency-Key posts once
  AssertionError: exactly one credit request   2 !== 1
✖ BUG-109: a balance adjustment sent twice with the same Idempotency-Key posts once
  AssertionError: adjusted once, not twice   110000 !== 105000
✔ BUG-109: the same key from two different admins is two separate actions
ℹ pass 1  ℹ fail 2
```

After the fix:

```
✔ BUG-109: a credit sent twice with the same Idempotency-Key posts once
✔ BUG-109: a balance adjustment sent twice with the same Idempotency-Key posts once
✔ BUG-109: the same key from two different admins is two separate actions
ℹ pass 3  ℹ fail 0
```

Neighbouring suites (adminCredits, adminCredits.new, adminBalanceAdjustments, admin/credits,
admin/balanceAdjustments): 41 pass, 0 fail. API typecheck clean. Admin: `npm test` 16 pass (incl.
`src/api/idempotency.new.test.ts`), typecheck and `npm run build` clean.
