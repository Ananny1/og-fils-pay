# BUG-026 — Admin page shows fee 245 bps while capture charges 225 bps

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Money · Admin display |
| **Analysis ID** | Q5 |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** the admin merchant page shows the merchant's "current" fee as **245 bps**, but every capture charges **225 bps**.
- **Why:** the page picks the fee row that was **typed in last** (`ORDER BY created_at DESC`). Capture picks the row that is **in effect now** (`effective_from <= now()`, newest first). A backdated correction for March, typed in on 15 August, is the last row typed — but it is not the current rate.
- **What it breaks:** ops and support quote the wrong fee to the merchant; a reconciliation looks wrong ("we show 2.45 %, you charged 2.25 %"); a future-dated rate also shows as "current" before it starts.

## 1. The issue

Merchant has two schedule rows: 225 bps effective 1 Aug (entered 1 Aug) and a backfilled 245 bps effective 1 Mar (entered 15 Aug). Admin page → 245. Capture → 225.

## 2. Why it happened — the root cause

`apps/api/src/fees/currentFeeScheduleDisplay.ts` (before):

```sql
SELECT mdr_bps, effective_from, created_at FROM fee_schedules
 WHERE merchant_id = $1
 ORDER BY created_at DESC
 LIMIT 1
```

The interface comment in the same file even says "returns the latest row whose effectiveFrom is not in the future" — the query did not do that.

**Traps (false claims) that kept it:**

| Where | Claim | Truth |
|---|---|---|
| `currentFeeScheduleDisplay.ts` comment | "FH: asked Claude, it said created_at is right for 'most recently agreed'. resolved" | Wrong: the display then disagrees with what capture charges (`getEffectiveMdrBps`). MK's question above it was right. |
| same | "am: display only, nobody bills off this. leave it" | Staff quote and reconcile from this page; a wrong number on an admin money screen is a bug. |
| `currentFeeScheduleDisplay.test.ts` | Test "returns the most recently entered schedule even when an older period was backfilled later" asserted 245 | The test encoded the bug; it was changed (see §6). |

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Told the wrong rate; statements look inconsistent | Medium |
| FilsPay ops / finance | Quote and reconcile against a wrong number | Medium |
| Customers | Not affected (they are charged by capture, which was right) | None |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/fees/currentFeeScheduleDisplay.ts` | Query now `WHERE merchant_id = $1 AND effective_from <= now() ORDER BY effective_from DESC, created_at DESC LIMIT 1` — the same rule as `getEffectiveMdrBps`; docblock updated. |

When no row is in effect yet the function returns `null` (unchanged contract); the page then uses `merchants.mdr_bps`, which is also what capture falls back to.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Same SQL rule as `getEffectiveMdrBps` (`effective_from <= now()`, then newest effective, then newest entered) | Display = what is charged; tiny change | Two copies of the rule | ✅ |
| 2 | Call `getEffectiveMdrBps` directly | One source of truth | It returns only the bps (no dates) and needs a `PoolClient` + fallback; bigger change to the page | |
| 3 (creative) | Show both: "in effect now: 225 (since 1 Aug)" and "last entered: 245 (for 1 Mar, entered 15 Aug)" | Admin sees backfills too | UI change in the admin app (frontend phase) | |
| 4 | Keep `created_at` order, add a label "last entered" | No query change | Still shows a rate that is not charged | |

**Why we chose #1:** it makes the page agree with the money path using the exact rule the money path uses, in one query.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `shows the rate in effect now, even when an older period was backfilled later` (changed) | `apps/api/src/fees/currentFeeScheduleDisplay.test.ts` | ❌ expected 225, got 245 | ✅ |
| `a schedule that starts in the future is not shown as current yet` (new) | same | ❌ expected 200, got 150 | ✅ |
| Other display + `feeSchedule.test.ts` tests | | ✅ | ✅ (9/9) |

Existing tests changed (and why): the "backfilled later" test asserted the buggy 245; it now asserts 225, the rate capture charges.
