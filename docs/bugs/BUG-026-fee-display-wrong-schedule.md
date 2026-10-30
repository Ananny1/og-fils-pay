# BUG-026 — Admin shows 245 bps while payments are charged 225 bps

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Money · Admin |
| **Analysis ID** | Q5 |
| **Clue** | MK's comment 15/06/2026 in `currentFeeScheduleDisplay.ts`, answered with "asked Claude, it said created_at is right" |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

The admin merchant page's "current negotiated rate" showed the schedule that was **keyed in last**,
not the one **in effect now**. A backdated correction (245 bps for March, entered 15 Aug) replaced the
live 225 bps (from 1 Aug) on screen, while every payment was correctly charged 225. A future-dated
renegotiation also showed as "current" before it started. Staff quoted wrong rates to merchants.

## 2. Why it happened — the root cause

`apps/api/src/fees/currentFeeScheduleDisplay.ts` (before):

```sql
SELECT mdr_bps, effective_from, created_at FROM fee_schedules
 WHERE merchant_id = $1
 ORDER BY created_at DESC     -- "most recently entered", ignores effective_from
 LIMIT 1
```

Capture uses `getEffectiveMdrBps` (`fees/feeSchedule.ts`): `effective_from <= asOf ORDER BY
effective_from DESC, created_at DESC`. Two different rules for "the rate" → they disagree. The concern
was raised in review and closed on an AI answer ("display only, nobody bills off this") — but staff
quote and reconcile off it. The existing test pinned the wrong value (245).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Told a different rate than they pay → disputes | Medium |
| FilsPay staff / finance | Wrong rate on the admin page; manual fee checks fail | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/fees/currentFeeScheduleDisplay.ts` | `WHERE effective_from <= now() ORDER BY effective_from DESC, created_at DESC` — the same rule as `getEffectiveMdrBps` |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Same SQL rule as `getEffectiveMdrBps` | One meaning of "current rate"; tiny | — | ✅ |
| 2 | Call `getEffectiveMdrBps` directly | Single source of truth | Needs a `PoolClient` and returns only bps (page also shows dates) | |
| 3 | Show both "latest entered" and "in effect" | More info | UI change; still confusing | |

## 6. Proof — tests

| Test | File | Before | After |
|---|---|---|---|
| backdated correction → 225 = charged | `apps/api/src/fees/currentFeeScheduleDisplay.new.test.ts` | ❌ 245 | ✅ 225 |
| future-dated schedule not current | same | ❌ 150 | ✅ 200 |

```bash
cd apps/api && npx tsx --test src/fees/currentFeeScheduleDisplay*.test.ts
```

Existing tests changed: `fees/currentFeeScheduleDisplay.test.ts` "backfilled later" test asserted the
bug (245); it now expects 225 with the 1 Aug dates.
