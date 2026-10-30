# BUG-009 — `expire_holds` deletes every hold on a night when nothing expired

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Money (card holds) |
| **Analysis ID** | B6 |
| **Clue** | HANDOVER: "`expire_holds.ts` flips `active` to `expired` with one UPDATE. Holds are never deleted." FH's comment in the script about SELECT-then-DELETE. AM in `0005_holds.sql`: "still UPDATEs for me?" |
| **Decision** | D-003 |
| **Owner** | Ebrahim (Track B) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** On a quiet night the cleanup script deleted every card hold in the database.
- **Why:** An empty list of expired holds made the helper drop the filter, so the script ran `DELETE FROM holds` with no condition.
- **What it breaks:** All records of money reserved on customers' cards vanish, so captures, releases and reconciliation lose their trail.

## 1. The issue — what was wrong

A **hold** is the money reserved on a customer's card when a payment is authorized, until it is
captured, released or expires. The nightly script `scripts/expire_holds.ts` is meant to mark
overdue holds as `expired`.

On a night when **no** hold has expired, the script **deletes every hold in the table**: active
ones, released ones, all of them. On nights when some did expire, it deletes those rows instead of
marking them, so their history is lost.

Reproduced on the seeded database (inside a rolled-back transaction):

```
{"expiredIds":0, "sql":"DELETE FROM holds", "deleted":4, "holdsBefore":4, "holdsAfter":0}
```

## 2. Why it happened — the root cause

Three things combine:

1. `scripts/expire_holds.ts` first selects the expired ids, then builds a delete from them:
   ```ts
   const expiredIds = await fetchExpiredHoldIds(client);          // [] on a quiet night
   const { text, values } = buildExpiredHoldsDelete(expiredIds);  // buildDelete("holds", { id: [] })
   ```
2. `scripts/lib/sqlFilter.ts` `buildWhere` **silently skips an empty array**:
   ```ts
   if (Array.isArray(val)) {
     if (val.length === 0) continue;   // filter dropped
   ```
   With no filter left, `clause` is `""`, and `buildDelete` returns **`DELETE FROM holds`** with no `WHERE`.
3. The script **deletes** at all, although the table has an `'expired'` status (0005) and the
   handover says holds are never deleted. The select-then-delete also has a race: a hold captured
   between the two queries is still deleted, because the delete only checks the id.

**Trap that hid it (TRAPS T-41):** MK's note in `0005_holds.sql` says the script deletes on purpose
"to keep this table small" and that `'expired'` is "only used transiently". The existing unit tests
only checked the SQL text for a non-empty id list, so they passed while the empty case wiped the table.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Their reservation record disappears while the authorization may still be live at the bank. No record left to release or reconcile it against | High |
| Merchants | Authorized-but-not-captured payments lose their hold, so capture and void can't release the right row; their open-authorization view is wrong | High |
| FilsPay finance / ops | Every quiet night wipes the holds table; there is no trail of what was held, released or expired for reconciliation or disputes | Critical |
| Acquirer / card scheme | FilsPay's hold records no longer match the acquirer's authorizations | Medium |

## 4. The fix

| File | Change |
|---|---|
| `scripts/expire_holds.ts` | Replaced select-then-delete with one statement: `UPDATE holds SET status = 'expired' WHERE status = 'active' AND expires_at < now()`, exported as `EXPIRE_HOLDS_SQL` / `expireHolds(client)`. Removed `fetchExpiredHoldIds`, `buildExpiredHoldsDelete` and the `sqlFilter` import. Header comment corrected. |
| `scripts/expire_holds.test.ts` | Unit tests now assert the statement is an UPDATE, never a DELETE, and is always scoped. |
| `scripts/expire_holds.integration.test.ts` | New: runs against the real database inside a rolled-back transaction. |

```ts
// after
export const EXPIRE_HOLDS_SQL = `UPDATE holds SET status = 'expired' WHERE status = 'active' AND expires_at < now()`;

export async function expireHolds(client: Pick<Client, "query">): Promise<number> {
  const result = await client.query(EXPIRE_HOLDS_SQL);
  return result.rowCount ?? 0;
}
```

Why this is the smallest correct change: one SQL statement does exactly what the handover and the
schema describe. It removes all three causes at once: there is no id list that can be empty, nothing
is deleted, and the condition is checked atomically in the same statement that changes the row.
No migration, no change to the API (capture/void already only release `'active'` holds).

`scripts/lib/sqlFilter.ts` is now unused. It is left in place to keep this commit minimal; its
"empty list = no filter" behaviour is noted as a follow-up.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | One atomic `UPDATE … SET status = 'expired' WHERE status = 'active' AND expires_at < now()` | Fixes the wipe, the deletion and the race together; matches HANDOVER and the `status` CHECK; one line of SQL | Rewrites the script's 3 small helpers | ✅ |
| 2 | Return early when the id list is empty, keep the delete | Smallest diff | Still deletes history; the race stays; HANDOVER says never delete | |
| 3 | Make `buildWhere` / `buildDelete` refuse an empty filter (throw) | Protects any future caller of the helper | On its own, still deletes rows and keeps the race | (good follow-up) |
| 4 | Keep SELECT, then `UPDATE … WHERE id = ANY($1) AND status = 'active'` | Keeps the two-step shape | Two queries for what one does; still needs an empty-list guard | |

**Why we chose #1:** it is the only option that makes the script do what the platform's own design
says (flip status, keep history), and it leaves no empty-list case or time gap to get wrong.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| a night with nothing expired changes no rows and deletes nothing | `scripts/expire_holds.integration.test.ts` | ❌ fails (written first; `expireHolds` didn't exist). The same scenario on the old code deleted 4 → 0 rows (reproduction in §1) | ✅ |
| only active holds past expires_at flip to 'expired'; nothing is deleted | `scripts/expire_holds.integration.test.ts` | ❌ fails (same reason); the old code deletes instead of flipping | ✅ |
| expiring holds is a status flip, never a delete | `scripts/expire_holds.test.ts` | ❌ (old SQL is a DELETE) | ✅ |
| the update is always scoped to active holds past expires_at | `scripts/expire_holds.test.ts` | ❌ | ✅ |
| expireHolds runs the one statement and reports the row count | `scripts/expire_holds.test.ts` | ❌ (function didn't exist) | ✅ |

```bash
# inside Docker (see docs/challenge/SETUP.md)
docker compose -f ops/docker-compose.yml run --rm -v "$PWD/scripts:/app/scripts" api \
  npx tsx --test scripts/expire_holds.test.ts scripts/expire_holds.integration.test.ts
# → tests 5, pass 5, fail 0.  All scripts tests: 8/8 pass.  tsc -p scripts: no errors.
```

Real run on the seeded data: `active:4` → `expire_holds: expired 4 abandoned hold(s)` → `expired:4`,
still 4 rows. A second run: `expired 0`, still 4 rows.

**Existing tests changed (D-004):** `scripts/expire_holds.test.ts`. Its two tests asserted the exact
`DELETE FROM holds WHERE id = ANY(...)` text, i.e. they locked in the deleting behaviour and never
tried the empty list. They were replaced by tests of the correct behaviour.
