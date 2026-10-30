# SEC-RT-5 — Any shop can read a marketplace child shop's transaction report

| | |
|---|---|
| **Severity** | High (cross-shop data leak) |
| **Area** | Security (access control, IDOR) |
| **Analysis ID** | — (found by the red team, round 2) |
| **Evidence** | Red-team "access" and "input" lenses both reproduced it independently |
| **Decision** | D-016 |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** `GET /v1/reporting/transactions?filter={"merchantId":"<other shop>"}` returns the other shop's transactions when that shop is a split-payout child of **any** marketplace.
- **Why:** The scope check asked "is this shop someone's split child?" instead of "is this shop **the caller's** split child?".
- **What it breaks:** Any merchant (or API key) can list a marketplace seller's transactions: amounts, statuses, dates. That's a confidentiality breach between competitors.

## 1. The issue

A shop sends a report filter naming another merchant's id. The report is meant to widen only for a
marketplace parent looking at its own children (Delta Marketplace and its sellers). Before the fix,
any caller got the child's data.

## 2. Why it happened

`apps/api/src/reporting/scope.ts` `resolveReportMerchantId`:

```sql
SELECT 1 FROM merchant_split_children WHERE child_merchant_id = $1   -- no parent check
```

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Marketplace sellers (split children) | Any FilsPay merchant could read their transaction list | High |
| FilsPay | Cross-tenant data leak (PDPL) | High |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/reporting/scope.ts` | The lookup also requires `parent_merchant_id = caller` (covered by the existing `UNIQUE (parent_merchant_id, child_merchant_id)` index) |
| `apps/api/src/reporting/scope.test.ts` | New tests |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Check that the caller is the child's parent | One SQL line; keeps the marketplace feature; uses an existing index | — | ✅ |
| 2 | Ignore `filter.merchantId` completely | Simplest | Breaks the parent's view of its sellers | |
| 3 | Return 403 for a foreign id instead of falling back to the caller | Louder for attackers | Changes the route's existing fallback behaviour for other callers | |
| 4 | Creative: one shared "may this caller see merchant X" helper used by every route | Stops this whole class of bug | A refactor; an enhancement | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| a parent can report on its own split child | `apps/api/src/reporting/scope.test.ts` | ✅ | ✅ |
| another merchant asking for someone else's split child gets its own data | same | ❌ got the child | ✅ |
| an unrelated merchant id falls back to the caller | same | ✅ | ✅ |

Full API suite after merging all security work: **500 / 500**. Reporting 12/12, Go all ok, `tsc` clean.
