# BUG-013 — Credit two-person check compares names, so a renamed admin can approve their own credit

| | |
|---|---|
| **Severity** | High |
| **Area** | Money (admin controls) |
| **Analysis ID** | A9 |
| **Clue** | HANDOVER "Credits": "The second approver is compared by admin user id." |
| **Owner** | Ebrahim (sprint stream S1) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** A big credit (above the limit) needs a second admin to approve it. The check that "the approver is not the requester" compares **display names**, not user ids.
- **Why:** `assertDistinctApprover` does `approver.displayName === requester.displayName`. The requester's name is a snapshot taken when the credit was asked for.
- **What it breaks:** One admin can request a large credit, change their display name, and approve it alone, so money goes to a shop with no second person. Also, two real people with the same name are wrongly blocked.

## 1. The issue

```
finance admin X: POST /v1/admin/credits  90.000 BD           -> pending_approval
admin X renames to "X (renamed)"
admin X: POST /v1/admin/credits/<id>/approve                 -> 200, credit posted to the ledger
```

## 2. Why it happened

`apps/api/src/admin/creditApproval.ts`:

```ts
if (approver.displayName === requester.displayName) {
  throw new ConflictError("self_approval_forbidden");
}
```

The id is passed in (`CreditActor.adminUserId`) but never used. False claim that hid it (trap):

| Where | Claim | Truth |
|---|---|---|
| `apps/api/src/admin/creditApproval.test.ts` | FH: "added a same-id/different-name case per copilot locally, it passes, so ids are covered too" | No such test existed. Written now, it **failed** against the old code |

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| FilsPay (finance) | One person can move large credits alone; the four-eyes rule is fake | High: fraud / mistake risk |
| Merchants | Can receive unchecked credits | Medium |
| Admins with the same name | Wrongly blocked from approving each other | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/admin/creditApproval.ts` | Compare `adminUserId` instead of `displayName` |
| `apps/api/src/admin/creditApproval.test.ts` | Two new cases (same id + new name → blocked; different ids + same name → allowed); false FH comment removed |
| `apps/api/src/admin/credits.test.ts` | DB test: maker renames themselves, approve → 409, nothing journaled |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Compare `adminUserId` in `assertDistinctApprover` | One line; matches HANDOVER; ids never change | none | ✅ |
| 2 | Compare both id and name (block if either matches) | Belt and braces | Still wrongly blocks two people with the same name | |
| 3 | Database `CHECK (approved_by_admin_user_id <> requested_by_admin_user_id)` on `credit_requests` (creative) | Enforced even if a new code path forgets the check | Needs a migration; extra work under time limit; could be a follow-up | |

**Why #1:** smallest change that matches the documented rule exactly.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `the same operator under a different display name is still a self-approval` | `apps/api/src/admin/creditApproval.test.ts` | ❌ did not throw | ✅ |
| `two different operators who share a display name may approve each other` | same | ❌ threw `self_approval_forbidden` | ✅ |
| `BUG-013: the maker cannot approve their own credit after renaming themselves` | `apps/api/src/admin/credits.test.ts` | ❌ approval succeeded | ✅ 409 |
| creditApproval + credits + routes/adminCredits | | | ✅ 25/25 |

```bash
npx tsx --test apps/api/src/admin/creditApproval.test.ts apps/api/src/admin/credits.test.ts apps/api/src/routes/adminCredits.test.ts
```

Existing tests changed: none (only a false comment removed).
