# BUG-064 — A posted manual credit is never paid out

| | |
|---|---|
| **Severity** | High |
| **Area** | Money · Settlement |
| **Analysis ID** | new (bug hunt, settlement area) |
| **Clue** | `credits.ts` posts to `merchant_payable`; `CloseBatch` never reads `credit_requests` |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-064` |
| **Owner** | Sayed |
| **Evidence** | Go test below |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** when staff give a shop a credit (goodwill, dispute, correction), the shop's balance goes up but the money is never sent to the shop.
- **Why:** the daily settlement run (`CloseBatch`) only adds up card captures and takes off refunds; it never looks at posted credits.
- **What it breaks:** the merchant is owed the credit forever; the ledger's `merchant_payable` never returns to zero.

## 1. The issue — what was wrong

A finance user issues a 5.250 BD credit to a merchant in the admin console. The credit is posted:
the ledger shows `merchant_payable` +5.250 and the merchant's cached balance goes up. The next
night's settlement batch pays the merchant only `gross − fee − refunds`. The 5.250 BD is never in
any batch, so it is never paid. Nothing else in the repo pays it either (searched `apps/`,
`scripts/`, `docs/HANDOVER.md`, `docs/ADMIN.md`, the ADRs: no payout path reads `credit_requests`
or `merchant_credit_contra`).

Reproduce: post a credit for a merchant, run `run-batch` for that day: `net_payout_fils` does not
include it, and after the payout the merchant's `merchant_payable` ledger balance is still the credit.

## 2. Why it happened — the root cause

`apps/api/src/admin/credits.ts:153-189` (`postCreditToLedger`) credits `merchant_payable` and
bumps `merchant_balances.cached_payable_fils`. `apps/settlement/internal/settlement/batch.go`
`CloseBatch` builds the payout from only two sources:

```go
// before — batch.go, CloseBatch
netPayout := NetPayableFils(batchGross, batchFee)   // capture events only
// Step 9: refunds deducted ...
```

**Present in the original code:** `apps/settlement/internal/settlement/batch.go:219` at 8b58b0f
(`netPayout := NetPayableFils(batchGross, batchFee)`, nothing reads `credit_requests`), with the
credit legs at `apps/api/src/admin/credits.ts:158,171` at 8b58b0f.

`PayoutBatch` then debits `merchant_payable` by `net_payout_fils` only. The credit legs stay on
`merchant_payable` with nothing that ever debits them.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | — | none |
| Merchants | Credits shown on their balance are never paid to their bank | High: real money owed |
| FilsPay (finance / ops) | `merchant_payable` never clears; reconciliation gap equal to every credit ever posted | High |
| Acquirer / card scheme / partners | — | none (credits are not card volume, scheme file unchanged) |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0100_credit_requests_settlement_batch.sql` | `credit_requests.settlement_batch_id` (which batch paid it) + partial index for the lookup |
| `apps/settlement/internal/settlement/batch.go` (Step 8b) | `CloseBatch` claims every posted, unbatched credit with `posted_at` before the end of the business day, `FOR UPDATE`, adds `base + fee_reversal` to the net, marks it with the batch id |
| `apps/settlement/internal/settlement/batch.go` (Step 14) | cache delta at close is `net − credits`, because the credit was already added to the cache when it was posted |

```go
// after
SELECT id, base_amount_fils + fee_reversal_fils FROM credit_requests
 WHERE merchant_id = $1 AND status = 'posted'
   AND settlement_batch_id IS NULL AND posted_at < $2   -- $2 = end of business day
 ORDER BY posted_at, id FOR UPDATE
...
netPayout += creditClaimed
UPDATE credit_requests SET settlement_batch_id = $2 WHERE id = ANY($1)
...
balances.ApplyBatchClose(ctx, tx, merchantID, batchID, netPayout-creditClaimed)
```

Same pattern as refunds (FP-300.3): claimed in the same transaction that freezes the batch, so a
credit is paid exactly once; re-closing a closed batch is still a no-op. Credits are added before
refunds, so a refund can be netted against a credit. `gross_fils`, `fee_fils`, the scheme export
and the platform volume counter are unchanged: a credit is not card volume. Pending (unapproved)
and rejected credits are never claimed (`status = 'posted'`). A credit posted after the day ended
waits for the next day's batch. Split parents: the credit is part of the net and is split across
the children like the rest of the payout.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | CloseBatch claims unbatched posted credits into the next payout (like refunds) | Small, exactly-once, uses existing payout/notification path, indexed | Credit timing is "next batch", not its effective date | ✅ |
| 2 | Separate "credit payout" job with its own disbursement | Clear separation | New payout path, new notifications, duplicates PayoutBatch | |
| 3 | Sum `merchant_payable` ledger legs not linked to a batch | Catches every source (adjustments too) | Ledger has no per-leg batch link; full scans; risky | |

**Why we chose #1:** it is the same proven mechanism refunds already use and touches one function.

Note for rollout: credits posted before this migration are all unbatched, so the first batch after
deploy pays every historic credit. That is correct (they are owed), but finance should check the
list first (`SELECT * FROM credit_requests WHERE status='posted' AND settlement_batch_id IS NULL`)
in case any were paid by hand.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestCloseBatch_PaysOutPostedCredit` | `apps/settlement/internal/settlement/credit_payout_fix_test.go` | ❌ `NetPayoutFils = 9750, want 15000` | ✅ passes: credit in net, ledger and cache clear after payout, late credit waits for next day, not paid twice |

```bash
cd apps/settlement && go test -p 1 ./...
```

Existing tests changed: none. Go suite green (`-p 1`); API credit tests (26) green on the migrated DB.
