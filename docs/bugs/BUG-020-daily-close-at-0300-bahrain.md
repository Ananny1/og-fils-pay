# BUG-020 — Daily close runs at 03:00 Bahrain instead of midnight

| | |
|---|---|
| **Severity** | High |
| **Area** | Settlement |
| **Analysis ID** | S1 (see `docs/challenge/ANALYSIS.md`) |
| **Clue** | Comment in `daemon.go`: "logs show the close ~03:15 local not 00:15??" |
| **Decision** | D-016 (4-hour sprint, stream S5) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** the settlement daemon closed each business day about 3 hours late
  (03:15 Bahrain), not 15 minutes after Bahrain midnight.
- **Why:** it took the "today" date from the **UTC** calendar, which only changes at
  00:00 UTC = 03:00 Bahrain. Settlement day is midnight Asia/Bahrain = 21:00 UTC.
- **What it breaks:** merchants get batches and payouts 3 hours late every day, and any
  instant handed to `BusinessDayWindow` between 21:00 and 24:00 UTC got the wrong day's window.

## 1. The issue

At 22:30 UTC on 24 March it is already 01:30 on 25 March in Bahrain, so business day
24 March is over and its close should run. The daemon instead thought "today" was still
24 March and only re-ran 23 March (a no-op). The 24 March close waited until 00:00 UTC +
delay = ~03:15 Bahrain.

## 2. Why it happened — the root cause

`apps/settlement/internal/settlement/window.go` `BusinessDayWindow`:

```go
// before
y, m, d := date.Date()   // date's own location: UTC in the daemon
start = time.Date(y, m, d, 0, 0, 0, 0, businessDayLocation)
```

`runIfDue` passes `time.Now().UTC()`, so `Date()` returns the UTC day.

False claims that hid it (for `TRAPS.md`):
- `daemon.go`: "MK: UTC here is fine, BusinessDayWindow converts to Bahrain." It did not convert;
  it only reused the UTC Y/M/D.
- `window_utc_compat_test.go` `TestBusinessDayWindow_IgnoresClockTime` passed 23:59:59 UTC
  (= 02:59 Bahrain next day) and expected the UTC day, locking the bug in.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Payout and `settlement.paid` webhook ~3 hours late every day | Medium, daily |
| FilsPay finance / ops | Close time does not match the documented Bahrain-midnight rule | Medium |
| Card scheme | Scheme export lines produced late | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/settlement/internal/settlement/window.go` | `date.Date()` → `date.In(businessDayLocation).Date()` |
| `apps/settlement/internal/scheduler/daemon.go` | Moved the "is it due, which date" decision into a pure `dueBusinessDate(now, delay)` so it can be tested; removed the false MK comment. Behaviour of `runIfDue` otherwise unchanged. |

```go
// after
y, m, d := date.In(businessDayLocation).Date()
```

CLI dates (`run-batch --date=YYYY-MM-DD`) are parsed as UTC midnight = 03:00 Bahrain the
same day, so they still map to the same business day. The daemon's business date is built in
the Bahrain zone, so `CloseBatch`'s `batch_date` uses the Bahrain Y/M/D too.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Convert to Bahrain inside `BusinessDayWindow` | One line; every caller gets the right day; CLI unchanged | Callers passing a UTC instant late at night now get the next day (correct) | ✅ |
| 2 | Only change the daemon: `now := time.Now().In(Asia/Bahrain)` | Also one line | Leaves the trap in `BusinessDayWindow` for the next caller; zone would be defined twice | |
| 3 | Set `TZ=Asia/Bahrain` in the container | No code change | Depends on deploy config; the code comment says the zone must never come from config | |
| 4 | (creative) Pass a plain `civil date` type (Y/M/D, no clock) everywhere | Makes the bug class impossible | Big refactor across batch, CLI and tests | |

**Why we chose #1:** the function's own doc says it returns the *Asia/Bahrain* business day; the fix makes the code match that in one place.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestDueBusinessDate_ClosesAfterBahrainMidnight` (22:30 UTC → close 24 Mar) | `apps/settlement/internal/scheduler/daemon_test.go` | ❌ business date = 2026-03-23 | ✅ |
| `TestDueBusinessDate_WaitsForGracePeriod` (21:05 UTC not due, 21:20 due) | same | ❌ due before grace period (wrong day) | ✅ |
| `TestBusinessDayWindow_UsesBahrainCalendarDay` | `apps/settlement/internal/settlement/window_utc_compat_test.go` | ❌ window [23 Mar 21:00, 24 Mar 21:00) | ✅ [24 Mar 21:00, 25 Mar 21:00) |
| Full Go suite | `apps/settlement` | ✅ | ✅ |

```bash
cd apps/settlement && go test ./...
```

Existing tests changed: `TestBusinessDayWindow_IgnoresClockTime` used 23:59:59 UTC, which is
the next Bahrain day; changed to 20:59:59 UTC (last second of the Bahrain day). It encoded the bug.
