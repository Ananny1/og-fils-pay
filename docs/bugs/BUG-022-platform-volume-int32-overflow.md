# BUG-022 — Platform volume counter overflows int32 just past the tier threshold

| | |
|---|---|
| **Severity** | High |
| **Area** | Settlement · Money |
| **Analysis ID** | S8 |
| **Clue** | `0049_platform_stats.sql` notes (AM: "INTEGER max is 2,147,483,647 and the tier threshold is 2,000,000,000?") |
| **Commit** | see `git log --grep BUG-022` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

The platform-wide lifetime volume counter decides the 0.15 % MDR volume-tier discount. Once the
platform passes 2,147,483.647 BD of settled volume, the counter wraps to a large negative number,
the discount silently switches off again, and fees jump back for every merchant. Reproduce: set
the counter to 2,100,000,000 and close a 100,000 BD batch → counter reads −2,094,967,296.

## 2. Why it happened — the root cause

`apps/settlement/internal/settlement/platform_volume.go:13-26,39-40`

```go
func ReadAndLockPlatformProcessedFils(...) (int32, error) { var current int32 ... }
updated := current + int32(batchGrossFils)                        // wraps
const volumeTierThresholdFils int32 = 2_000_000_000              // 93% of int32 max
```

and `db/migrations/0049_platform_stats.sql`: `total_processed_fils INTEGER`. Postgres `INTEGER` is
always 32-bit. The tier threshold is only 147,483.647 BD below the type's maximum.

False claims: 0049 "INTEGER in PostgreSQL is 64-bit on 64-bit builds"; `platformVolumeTier.ts`
"total_processed_fils is BIGINT so no overflow risk (Claude double-checked)". Both wrong.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | discount appears, then disappears after ~147k BD more volume; API capture and settlement could disagree on the fee | High once volume reaches the tier |
| FilsPay finance | fee revenue jumps without any decision | Medium |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0077_platform_stats_bigint.sql` | `ALTER COLUMN total_processed_fils TYPE BIGINT` (lossless) |
| `apps/settlement/internal/settlement/platform_volume.go` | read, add and compare as `int64` |
| `apps/api/src/fees/platformVolumeTier.ts` | BIGINT now arrives as text from `pg` → `Number(...)` before comparing |

Both halves are needed: widening only the column still wraps in Go; widening only Go would fail
to write past 2^31 in Postgres.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | BIGINT column + int64 Go | lossless, matches every other fils column | one migration | ✅ |
| 2 | `SET x = x + $1` in SQL with BIGINT | no Go read | changes the read-then-write design used for fee pricing | |
| 3 | Leave INTEGER, cap at max | no migration | counter becomes meaningless | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestRecordPlatformProcessedVolume_PastInt32Max` | `apps/settlement/internal/settlement/platform_volume_fix_test.go` | ❌ `-2094967296`, want `2200000000` | ✅ and tier bonus = 15 |
| existing `platformVolumeTier.test.ts` | `apps/api/src/fees/` | ✅ | ✅ |

```bash
npm run migrate
cd apps/settlement && go test ./internal/settlement/ -run PastInt32Max -count=1
```

Existing tests changed: none. Note: whether the 0.15 % tier was ever approved by finance is open
(MK: "which finance ticket? cant find one"; HANDOVER: YA said no until finance signs off in
writing). Not changed here — flagged to the team.
