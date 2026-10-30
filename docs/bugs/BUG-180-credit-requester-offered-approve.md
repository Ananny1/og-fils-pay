# BUG-180 — The operator who raised a credit is offered "Approve" on it

| | |
|---|---|
| **Severity** | Low |
| **Area** | Money · roles (staff console) |
| **Commit** | see `git log --grep BUG-180` |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

## Summary

- **What's wrong:** on Credits → "Awaiting approval", the finance admin who raised a credit sees an Approve button on their own request.
- **Why:** the button is gated only by role (`RequireRole finance/super_admin`), not by the two-person rule.
- **What it breaks:** the click always fails with `409 self_approval_forbidden`; the maker thinks the credit is stuck or the console is broken, and the pending credit waits longer.

## Root cause

Present in the original code: `apps/admin/src/pages/credits/CreditsPage.tsx:171-180` at 8b58b0f
(Approve inside `RequireRole` only, no check of `requestedByAdminUserId`).

The server rule (`apps/api/src/admin/creditApproval.ts:11`) refuses approval when
`approver.adminUserId === requester.adminUserId`. The page already has both ids
(`CreditRequestDto.requestedByAdminUserId`, `useAdminAuth().admin.adminUserId`) and did not use them.

## Fix

`apps/admin/src/creditRules.ts` `canApproveCredit(item, adminUserId)` = pending and not the
requester (same comparison as the server, by id). The page shows "your request: needs another
approver" instead of Approve for the requester. Reject stays (the server allows it).

## Options

| Rank | Option | Chosen? |
|---|---|---|
| 1 | Hide Approve for the requester, explain why | ✅ |
| 2 | Keep the button, show a friendlier error after the 409 | still offers an action that can never work |
| 3 | Disable the button with a tooltip | tooltip is easy to miss on touch |

## Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| requester is not offered Approve | `apps/admin/src/creditRules.new.test.ts` | ❌ `true` (role-only rule) | ✅ `false` |
| other operator / decided credit | same | ✅ | ✅ |

`npm test -w apps/admin` → 14 pass, 0 fail.
