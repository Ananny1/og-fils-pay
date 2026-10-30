# BUG-094 — Bulk "Approve KYC" also approves merchants no longer on screen

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Security · Onboarding (staff console) |
| **Commit** | see `git log --grep BUG-094` |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

## Summary

- **What's wrong:** ticks survive a new search or status filter; "Bulk approve KYC" sends them too, though the operator can no longer see them.
- **Why:** `approveSelected` sends `[...selectedIds]`, the whole tick set, not the ticked rows in the current table.
- **What it breaks:** merchants get KYC-approved (and can take live payments) without the operator seeing them in the list they approved.

## Root cause

Present in the original code: `apps/admin/src/pages/merchants/MerchantListPage.tsx:90` at 8b58b0f:

```ts
const result = await bulkApproveKyc([...selectedIds]);
```

`load(null)` replaces `merchants` on every search/filter change, but `selectedIds` is never
reset. Reproduce: filter `under_review`, tick A and B, search for C, tick C → the bar shows
"3 selected" and Approve sends A, B and C.

## Fix

`apps/admin/src/selection.ts` `visibleSelection(selected, rows)` returns only ticked ids that are
rows on screen. The page uses it for the request, the "N selected" count and the select-all box.

## Options

| Rank | Option | Chosen? |
|---|---|---|
| 1 | Act only on ticked rows that are visible | ✅ |
| 2 | Clear all ticks on every filter change | loses ticks on "Load more" refreshes too |
| 3 | Confirm dialog listing the ids | still sends hidden ids |

## Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| only ticked rows still on screen are acted on | `apps/admin/src/selection.new.test.ts` | ❌ got `["a","b","c"]` | ✅ `["c"]` |
| nothing ticked on screen sends nothing | same | ❌ got `["a"]` | ✅ `[]` |

`npm test -w apps/admin` → 11 pass, 0 fail.
