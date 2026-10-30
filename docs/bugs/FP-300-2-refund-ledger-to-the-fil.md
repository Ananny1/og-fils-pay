# FP-300.2 — Refund ledger correct to the fil (fee reversal = fee actually paid)

| | |
|---|---|
| **Severity** | High (money: fee over-reversed) · ★★★ |
| **Area** | Refunds (FP-300) · Ledger · Fees |
| **Analysis ID** | FP-300 §4 items 3–4 (fees, ledger); P3 (discount) |
| **Clue** | S2 FP-300 sheet: "ledger … to the fils", "fees right"; YA note in `routes/refunds.ts`: "the helpers were written before the capture discount and tier existed" (true) |
| **Owner** | Stream S6 |
| **Status** | ✅ done |

## Summary (the short note)

- **What's wrong:** For a shop with a negotiated discount, a full refund gives the shop back **more fee than it paid**. Example: 10.000 BD sale, MDR 250 fils, 10 % discount → shop paid 225 fils; refund reversed 250. FilsPay loses 25 fils per refund and the ledger for that sale never returns to zero.
- **Why:** The refund read "fee charged" as the sum of `platform_fee_revenue` **credits** only. The discount is posted afterwards as a `platform_fee_revenue` **debit** (`capture: negotiated discount adjustment`), which the refund ignored.
- **What it breaks:** Fee revenue under-reported, merchant payable over-stated by the discount on every refunded discounted sale; reconciliation can't tie out.

## 1. The issue

Test (before): merchant `mdr_bps = 250`, `negotiated_discount_bps = 1000`, capture 10 000 through the route (discount
applied, net fee 225), full refund → `feeReversedFils = 250`; after the refund `platform_fee_revenue` nets to −25 and
`merchant_payable` to +25 for that sale.

## 2. Why it happened

```sql
-- apps/api/src/payments/processRefund.ts (before)
SELECT COALESCE(SUM(amount_fils), 0) FROM ledger_entries
 WHERE transaction_id = $1 AND account_id = 'platform_fee_revenue' AND direction = 'credit'
```

The discount was added later (`discountAdjustment.ts`) and nobody updated the refund helper.

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/payments/processRefund.ts` | fee paid = `platform_fee_revenue` credits − debits for the sale, **excluding** earlier `refund:` reversals (floored at 0) |
| `apps/api/src/payments/processRefund.test.ts` | new test: discounted sale, full refund → reversal equals net fee paid and **every account nets to exactly 0** for the sale |

The reversal legs themselves were already balanced (verified by the existing "ledger group balances" test).
Works whatever way capture records the discount (separate adjustment today, or folded into the fee if P3 is fixed).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Read the **net** fee from the ledger (credits − non-refund debits) | One query change; ledger stays the single source; robust to how the discount is posted | Relies on the `refund:` description prefix to exclude reversals | ✅ |
| 2 | Recompute the fee from `mdr_bps` and `negotiated_discount_bps` | No ledger read | Wrong after any rate change; the code comment rejects this for good reason | |
| 3 | Store `fee_fils` on `transactions` at capture and read it | Fast, explicit | Migration + capture change + backfill | |
| 4 (creative) | Post refunds as an exact mirror of **every** capture-group leg scaled by `refund / captured` | Ledger nets to zero by construction for any future leg type | Rounding per leg needs the cumulative trick (BUG-056) for each; larger change | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| `a full refund nets every ledger account to zero, even with a negotiated discount` | `apps/api/src/payments/processRefund.test.ts` | ❌ expected 225, actual 250 | ✅ |
| all other refund + route tests (20) | `processRefund.test.ts`, `routes/refunds.test.ts` | ✅ | ✅ |

Existing tests changed: none.
