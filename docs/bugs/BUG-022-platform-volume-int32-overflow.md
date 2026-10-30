# BUG-022 — Platform volume counter overflows int32

| | |
|---|---|
| **Severity** | High |
| **Area** | Money · Settlement · Database |
| **Analysis ID** | S8 (see `docs/challenge/ANALYSIS.md`) |
| **Decision** | D-016 (4-hour sprint, stream S5) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** the platform-wide "total processed" counter stops working just after
  2,147,483.647 BD.
- **Why:** it is stored as `INTEGER` (32-bit) in Postgres and held as `int32` in Go. The volume-tier
  threshold is 2,000,000,000 fils, only ~7 % below the limit.
- **What it breaks:** in Go the sum silently **wraps to a negative number** (test: −2,146,484,296),
  so the 0.15 % volume discount switches **off** again for every merchant. Writing a bigger value
  from SQL fails with "out of range for type integer", which aborts the batch close.

## 1. The issue

`CloseBatch` reads the counter, prices the batch fee with the tier bonus, then writes
`current + batchGross` back. Starting at 2,147,483,000 and adding a 1,000 BD batch wrote
−2,146,484,296. The API side (`getVolumeTierBonusBps`) cannot even store 3,000,000,000.

## 2. Why it happened — the root cause

```sql
-- db/migrations/0049_platform_stats.sql
total_processed_fils INTEGER NOT NULL DEFAULT 0,
```

```go
// platform_volume.go (before)
func ReadAndLockPlatformProcessedFils(...) (int32, error)
updated := current + int32(batchGrossFils)
func VolumeTierMdrBonusBps(totalProcessedFils int32) int64
```

False claims that hid it (for `TRAPS.md`):
- `0049` comment: "FH: asked claude — INTEGER in PostgreSQL is 64-bit on 64-bit builds". False: `INTEGER` is always 4 bytes.
- `apps/api/src/fees/platformVolumeTier.ts`: "total_processed_fils is BIGINT so no overflow risk (Claude double-checked the migration)". False: it was `INTEGER`.
- `platformVolumeTier.test.ts`: "should test right at int32 max too? nvm its bigint". False.
- The "no BIGINT" rule mentioned in the sprint brief was a trap; every other fils column (`settlement_batches.*_fils`) is already `BIGINT`.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| All merchants | Lose the 0.15 % volume-tier discount after the wrap; or batch close errors | High once volume passes 2.1M BD |
| FilsPay finance / ops | Counter shows a negative total; daily close may fail | High |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0090_platform_stats_bigint.sql` | `ALTER COLUMN total_processed_fils TYPE BIGINT` (new migration; 0049 untouched because it is already applied everywhere) |
| `apps/settlement/internal/settlement/platform_volume.go` | `int32` → `int64` in read, add and tier check |
| `apps/api/src/fees/platformVolumeTier.ts` | `pg` returns BIGINT as a string → `Number(...)` before comparing; false comment replaced |

`batch.go` needed no change (it only passes the value through).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | BIGINT column + int64 in Go + `Number()` in TS | Exact to 9.2×10^18 fils; matches other fils columns | Needs a migration | ✅ |
| 2 | Keep INTEGER, store BD instead of fils | No migration type change | Breaks the "money is integer fils" rule; loses precision | |
| 3 | Cap the counter at the threshold (it is only used for `>=`) | No schema change | Hides real volume; still breaks if threshold is raised | |
| 4 | (creative) Drop the counter and compute volume from `SUM(settlement_batches.gross_fils)` | One source of truth, no drift | Slower read on every close; bigger change | |

**Why we chose #1:** smallest change that removes the limit everywhere the value lives.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestRecordPlatformProcessedVolume_PastInt32Max` | `apps/settlement/internal/settlement/platform_volume_test.go` | ❌ total = −2,146,484,296 | ✅ 2,148,483,000 and bonus 15 |
| `the tier stays granted past int32 max` | `apps/api/src/fees/platformVolumeTier.test.ts` | ❌ `value "3000000000" is out of range for type integer` | ✅ |
| Full Go suite, `tsc --noEmit -p apps/api` | | ✅ | ✅ |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -T -e DATABASE_URL=... -v "$PWD/db:/app/db" migrate
cd apps/settlement && go test ./internal/settlement/ -run PlatformProcessed
```

Existing tests changed: none (cases added). **Deploy note:** run migrations (0090) before the new settlement binary.
