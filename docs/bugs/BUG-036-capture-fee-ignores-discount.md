# BUG-036 — Capture fee ignores the merchant's negotiated discount (ledger ≠ settlement)

| | |
|---|---|
| **Severity** | High |
| **Area** | Money · Settlement |
| **Analysis ID** | P3 (see `docs/challenge/ANALYSIS.md`) |
| **Clue** | Comment in `pay.ts`: "discountAdjustment is applied by the transactions route only" / "MK: it's applied for both now (moved into capture.ts in July)" |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-036` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

Merchants with a negotiated discount (e.g. Alpha Retail 75 bps, Omicron 75 bps in the seed) were
charged one fee in the ledger at capture time and a different fee in the daily settlement batch. The
ledger's `merchant_payable` and the batch's `fee_fils` never tied, so reconciliation always showed a
difference, and the merchant dashboard fee did not match the payout statement.

Example: 0.602 BD captured, MDR 275 bps, discount 1250 bps.

| Where | Fee |
|---|---|
| Settlement batch (Go `ComputeSettlementFee`) | 602 − 75 = 527 → 527 × 2.75% = **14 fils** |
| Ledger, payment-link checkout | **17 fils** (no discount at all) |
| Ledger, `POST /v1/transactions/:id/capture` | 17 − 2 = **15 fils** (discount taken off the fee afterwards, different rounding) |

## 2. Why it happened — the root cause

`apps/api/src/payments/capture.ts` computed the fee from MDR only:

```ts
// before
const feeFils = applyRateFils(requestedAmount, Math.max(0, effectiveMdrBps - volumeTierBonusBps));
```

The discount was bolted on afterwards by `applyCaptureDiscountAdjustment` (`discountAdjustment.ts`),
which (a) is only called from `routes/transactions.ts`, never from the payment-link checkout, and
(b) discounts the **fee** (`applyRateFils(fee, discountBps)`), while settlement discounts the
**amount** first and then applies MDR:

```go
// apps/settlement/internal/settlement/discounted_fee.go (the reference)
discountedAmount := amountFils - money.ApplyRateFils(amountFils, discountBasisPoints)
return money.ApplyRateFils(discountedAmount, mdrBasisPoints)
```

Two roundings in a different order give different fils. False claim: "MK: it's applied for both
now (moved into capture.ts in July)" — capture.ts never read `negotiated_discount_bps`.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants with a discount | Over-charged on every payment-link sale (full MDR); a few fils off on API captures | Medium — small per txn, every txn |
| FilsPay (finance / ops) | Ledger fee revenue ≠ settlement fee; daily reconciliation never ties; refunds reverse the ledger fee, not the settled one | High |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/payments/capture.ts` | reads `negotiated_discount_bps`; fee = MDR on (amount − discount), exactly `ComputeSettlementFee`; records `discountBps` in the capture event metadata |
| `apps/api/src/payments/discountAdjustment.ts` | returns early when the capture event carries `discountBps` (fee already net), so the route does not discount twice; legacy events without it still get the old adjustment |
| `apps/api/src/paymentLinks/pay.ts` | false comment replaced |

```ts
// after
const discountedAmount = subtractFils(requestedAmount, applyRateFils(requestedAmount, discountBps));
const feeFils = applyRateFils(discountedAmount, Math.max(0, effectiveMdrBps - volumeTierBonusBps));
```

Smallest correct change: the fee is computed once, in the same DB transaction as the capture, with
the same integer formula as settlement. Both checkout paths get it for free. The route's call to
`applyCaptureDiscountAdjustment` is left in place (it is now a no-op for new captures) so
`routes/transactions.ts` does not need to change.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Compute the discounted fee inside capture, settlement's order; make the post-capture adjustment skip already-net events | One formula, one transaction, works for payment links too | Old (pre-fix) events still use the old adjustment | ✅ |
| 2 | Also call `applyCaptureDiscountAdjustment` from the checkout and change its formula to "gross fee − settlement fee" | No change to capture's fee | Two DB transactions (fee can be left un-discounted on a crash), more code paths | |
| 3 | Change Go settlement to the API's "fee then discount" order | API untouched | Settlement is the documented reference; re-prices closed batches | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-036: capture charges the same fee settlement will (discount off the amount, then MDR)` | `apps/api/src/payments/capture.new.test.ts` | ❌ 17 vs 14 | ✅ 14 = 14 |
| `BUG-036: the transactions route's post-capture adjustment does not discount a second time` | same | ❌ 15 vs 14 | ✅ 14 = 14 |

```bash
DATABASE_URL=... npx tsx --test apps/api/src/payments/capture.new.test.ts
```

Existing tests changed: none (`discountAdjustment.test.ts` seeds legacy events without `discountBps`
and still passes). Go settlement unchanged.
