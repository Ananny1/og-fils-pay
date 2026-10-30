# BUG-034 — Any merchant can read the transaction report of any split-child merchant

| | |
|---|---|
| **Severity** | High |
| **Area** | Security |
| **Analysis ID** | — (new) |
| **Clue** | `routes/reporting.ts` header ("in the intended, single-merchant case"); `filter.merchantId` accepted from the client |
| **Decision** | — |
| **Commit** | see `git log --grep "BUG-034"` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

`GET /v1/reporting/transactions?filter={"merchantId":"<id>"}` lets a parent
merchant (a marketplace or franchise) report on its split children. But any
merchant could put **any** child merchant's id in the filter and get that
merchant's full transaction report — amounts, statuses, references.

Reproduce: merchant X (no relation) calls the report with the id of merchant
P's child C → the response is C's transactions.

## 2. Why it happened — the root cause

`apps/api/src/reporting/scope.ts resolveReportMerchantId`:

```ts
// before
SELECT 1 AS ok FROM merchant_split_children WHERE child_merchant_id = $1
```

It only asked "is this id somebody's child?", never "is it **the caller's**
child?". `callerMerchantId` was passed in but not used in the query.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Their transactions at child merchants visible to strangers | Medium |
| Merchants | Every split-child merchant's sales data readable by any merchant or API key | High |
| FilsPay (finance / ops) | Tenant isolation broken | High |
| Acquirer / card scheme / partners | — | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/reporting/scope.ts` | add `AND parent_merchant_id = $2` (the authenticated caller) |

```sql
-- after
SELECT 1 AS ok FROM merchant_split_children
 WHERE child_merchant_id = $1 AND parent_merchant_id = $2
```

A non-matching request falls back to the caller's own merchant, exactly as
before for unknown ids — the existing behaviour for a bad id is kept.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Require the caller to be the child's parent | One predicate | — | ✅ |
| 2 | Return 403 when the id is not the caller's child | Explicit | Changes the current fallback behaviour clients may rely on | |
| 3 | Drop `merchantId` from the filter | Simplest | Breaks the parent/child reporting feature | |

**Why we chose #1:** keeps the feature, removes the cross-tenant read.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-034: a merchant cannot report on another parent's split child` | `apps/api/src/reporting/scope.new.test.ts` | ❌ outsider resolved to the child | ✅ outsider gets itself; parent still gets its child; child cannot read parent |

```bash
cd apps/api && npx tsx --test src/reporting/scope.new.test.ts
```

Existing tests changed: none.
