# BUG-110 — Refund summary view is always empty

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Reporting |
| **Analysis ID** | R7 |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** the per-merchant, per-day refund summary never shows any refund.
- **Why:** the view joins `transactions` on the refund's own id instead of `refunds.transaction_id`.
- **What it breaks:** finance/admin see zero refunds and zero fee reversals for every shop and day.

## 1. The issue

Make a refund, refresh `refund_merchant_summary`: the view returns 0 rows.

## 2. Root cause

Present in the original code: `db/migrations/0072_refund_merchant_summary.sql:14` at 8b58b0f.

```sql
FROM refunds r
JOIN transactions t ON t.id = r.id   -- r.id is the refund's id, never a transaction id
```

The inner join matches nothing, so every refund row is dropped.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | none directly | — |
| FilsPay (finance / ops) | refund totals and fee reversals missing from the summary | Medium: refunds look like they never happened |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0110_refund_merchant_summary_join.sql` | drop and recreate the view joining `t.id = r.transaction_id`, same columns and unique index |

0072 is already applied, so it is not edited.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | New migration recreating the view with the right join | small, same shape | full drop/recreate (view is small) | ✅ |
| 2 | Edit 0072 | one line | applied migrations must not change; existing DBs keep the bug | |
| 3 | Drop the view (no code reads it today) | less code | loses a reporting feature | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `a succeeded refund shows up in refund_merchant_summary ...` | `scripts/refund_merchant_summary.new.test.ts` | ❌ `AssertionError: the refund must appear in the summary` (0 rows) | ✅ pass (1 row: 3000 refunded, 75 fee, 10000 captured) |

```bash
DATABASE_URL=... npx tsx --test scripts/refund_merchant_summary.new.test.ts
```

Note (not fixed): `original_captured_fils` sums the transaction's capture once per refund, so two
partial refunds of one payment count its capture twice. Left as is; needs a product decision.
