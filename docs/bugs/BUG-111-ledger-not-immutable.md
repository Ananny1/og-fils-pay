# BUG-111 — Posted ledger entries can be edited, deleted, or left unbalanced

| | |
|---|---|
| **Severity** | High |
| **Area** | Money |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** money already booked in the ledger can be changed or removed, and a group can end up with debits ≠ credits.
- **Why:** the 0007 balance trigger only re-checks the group the row is in *after* the change, and nothing blocks UPDATE/DELETE.
- **What it breaks:** the ledger (the only source of truth for balances and payouts) can be silently rewritten.

## 1. The issue

Inside one transaction: move the debit leg of group A into group B, then raise B's credit to 200.
The commit succeeds. Group A is now `-100` (unbalanced) forever. Also `UPDATE ... SET amount_fils = 1`
on both legs of a group, or `DELETE` of a whole group, commits without any error.

## 2. Root cause

Present in the original code: `db/migrations/0007_ledger_double_entry.sql:47-51` and `:66-74` at 8b58b0f.

```sql
IF TG_OP = 'DELETE' THEN
    v_group_id := OLD.entry_group_id;
ELSE
    v_group_id := NEW.entry_group_id;   -- on UPDATE the OLD group is never checked
END IF;
...
-- Immutability: the trigger runs on UPDATE and DELETE as well, so an edited
-- or removed leg unbalances its group and the commit is rejected. No
-- separate reject trigger or REVOKE is needed.
```

False claim: "no separate reject trigger is needed". A balanced edit or a whole-group delete never
unbalances anything, and an UPDATE that changes `entry_group_id` only checks the new group.
The same false claim is repeated in `apps/settlement/internal/settlement/recalculate_mdr_test.go:96`.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | balances rebuilt from the ledger can change after the fact | High |
| FilsPay (finance / ops) | audit trail not trustworthy; unbalanced groups possible | High |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0111_ledger_entries_append_only.sql` | `BEFORE UPDATE OR DELETE` row trigger that raises; ledger is append-only |

No code updates or deletes ledger rows (corrections are new reversing groups; seed reset uses
TRUNCATE, which does not fire row triggers), so this changes no working flow.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Reject UPDATE/DELETE with a trigger | matches the documented intent; closes all three holes | an operator can no longer hand-edit (by design) | ✅ |
| 2 | Also check `OLD.entry_group_id` on UPDATE | keeps groups balanced | balanced edits/deletes still allowed | |
| 3 | `REVOKE UPDATE, DELETE` from the app role | no trigger | compose uses one owner role (HANDOVER), so it would not bite | |

## 6. Proof — tests

`scripts/ledger_append_only.new.test.ts` (rolled-back transactions; `SET CONSTRAINTS ALL IMMEDIATE` fires the deferred check like COMMIT).

| Test | Before fix | After fix |
|---|---|---|
| moving a leg to another group cannot leave the old group unbalanced | ❌ `group A must still balance` (net -100) | ✅ |
| a posted, balanced group cannot be edited | ❌ update accepted | ✅ |
| a posted, balanced group cannot be deleted | ❌ delete accepted | ✅ |
| new balanced groups still post, unbalanced ones are still refused | ✅ | ✅ |

```bash
DATABASE_URL=... npx tsx --test scripts/ledger_append_only.new.test.ts
cd apps/settlement && go test ./...   # all ok with 0111 applied
```
