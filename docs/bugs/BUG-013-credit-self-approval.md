# BUG-013 — One admin can approve their own large credit

| | |
|---|---|
| **Severity** | High |
| **Area** | Security · Money |
| **Analysis ID** | A9 |
| **Clue** | HANDOVER "The second approver is compared by admin user id"; `0060_credit_requests.sql` "display_name is mutable"; FH's comment in `creditApproval.test.ts` |
| **Decision** | — |
| **Commit** | see `git log --grep "BUG-013"` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

Credits above 50.000 BD need a second person to approve them. The check
compared the two operators' **display names**, not who they are. So:

- An admin creates a 120 BD credit, changes their display name, and approves
  it themselves. Money posts to the merchant with one person's decision.
- Two real, different people who happen to share a name ("Ali Hasan") are
  wrongly blocked from approving each other.

## 2. Why it happened — the root cause

`apps/api/src/admin/creditApproval.ts`:

```ts
// before
if (approver.displayName === requester.displayName) {
  throw new ConflictError("self_approval_forbidden");
}
```

The requester's name is a snapshot taken when the request was made
(`credit_requests.requested_by_display_name`), and `admin_users.display_name`
is mutable (0060 says so). The ids were passed in but ignored.

The FH comment "added a same-id/different-name case ... it passes, so ids are
covered too" is false — that case fails (see test below).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | — | — |
| Merchants | Could receive credits approved by one insider | Medium |
| FilsPay (finance / ops) | Two-person control on money could be bypassed by one person; same-name staff blocked | High |
| Acquirer / card scheme / partners | — | — |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/admin/creditApproval.ts` | compare `adminUserId` instead of `displayName` |

```ts
// after
if (approver.adminUserId === requester.adminUserId) {
```

The id is the immutable identity of an operator; the route already passes
the authenticated admin's id as the approver and the stored
`requested_by_admin_user_id` as the requester.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Compare admin user ids | One line; matches HANDOVER | — | ✅ |
| 2 | Compare ids OR names | Blocks both | Still blocks two different people with the same name | |
| 3 | Make display names unique and immutable | — | Schema change; wrong layer | |

**Why we chose #1:** identity is the id; that is what two-person control is about.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-013: the same operator under a different display name is still self-approval` | `apps/api/src/admin/creditApproval.new.test.ts` | ❌ no error | ✅ 409 `self_approval_forbidden` |
| `BUG-013: two different operators who share a display name may approve each other` | same | ❌ blocked | ✅ allowed |
| `BUG-013: an admin who renames themselves cannot approve their own credit` | same (real DB) | ❌ approved | ✅ rejected, still `pending_approval` |

```bash
cd apps/api && npx tsx --test src/admin/creditApproval.new.test.ts src/routes/adminCredits.test.ts
```

Existing tests changed: none.
