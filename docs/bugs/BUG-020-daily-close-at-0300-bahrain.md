# BUG-020 — Daily close runs at 03:00 Bahrain instead of just after midnight

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Settlement |
| **Analysis ID** | S1 |
| **Clue** | `daemon.go` (am: "logs show the close ~03:15 local not 00:15??"); HANDOVER "The daemon's 'yesterday' is computed from the UTC date" |
| **Commit** | see `git log --grep BUG-020` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

The settlement daemon should close yesterday's Bahrain business day 15 minutes after Bahrain
midnight (21:15 UTC). It actually closes it at 03:15 Bahrain (00:15 UTC). For three hours every
night merchants see yesterday still open, payouts and `settlement.paid` webhooks are three hours
late, and between 00:00 and 03:00 Bahrain the daemon keeps re-attempting the day **before**
yesterday.

## 2. Why it happened — the root cause

`apps/settlement/internal/settlement/window.go:44` and `scheduler/daemon.go:80-90`

```go
now := time.Now().UTC()
todayStart, _ := settlement.BusinessDayWindow(now)
...
func BusinessDayWindow(date time.Time) (start, end time.Time) {
	y, m, d := date.Date()          // calendar date in date's OWN location (UTC)
	start = time.Date(y, m, d, 0, 0, 0, 0, businessDayLocation)
```

`date.Date()` returns the **UTC** calendar date. From 21:00 to 24:00 UTC it is already the next
day in Bahrain, but the window still says "the UTC day", so "today" only flips at 00:00 UTC =
03:00 Bahrain.

Traps: "MK: UTC here is fine, BusinessDayWindow converts to Bahrain" (it converts the date's
*digits*, not the instant); HANDOVER "BusinessDayWindow … is correct and tested" (the test
`TestBusinessDayWindow_IgnoresClockTime` pinned 23:59:59 UTC as 31 Dec — which is 02:59 on 1 Jan in
Bahrain).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | payouts and notifications 3 h late every day | High |
| FilsPay ops | close runs outside the agreed window; daily cut-off wrong | High |

## 4. The fix

| File | Change |
|---|---|
| `apps/settlement/internal/settlement/window.go:44` | `date.In(businessDayLocation).Date()` — the Bahrain date of the instant |
| `apps/settlement/internal/settlement/batch.go:62` | `batch_date` taken from the window start (Bahrain date), so the stored date always matches the window it covers |
| `apps/settlement/internal/scheduler/daemon.go` | due-date decision extracted to `dueBusinessDate(now, delay)` (same logic) so it can be tested |

CLI and internal API pass dates at 00:00 UTC, which is 03:00 Bahrain on the same date, so their
behaviour is unchanged. The daemon passes a real instant and now gets the Bahrain day.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Convert to Bahrain inside `BusinessDayWindow` | one place defines the business day; every caller correct | old test case encoded the bug | ✅ |
| 2 | Convert only in the daemon (`time.Now().In(bahrain)`) | window untouched | needs a second copy of the zone (window.go says "exactly one place") | |
| 3 | Shift the daemon delay by −3 h | no code | hack; breaks if delay changes | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestDueBusinessDate_BahrainMidnight` | `apps/settlement/internal/scheduler/daemon_fix_test.go` | ❌ at 00:20 Bahrain picks 23 Mar instead of 24 Mar; runs inside grace period | ✅ |
| `TestBusinessDayWindow_UsesBahrainDateOfInstant` | `apps/settlement/internal/settlement/window_fix_test.go` | ❌ window of the UTC day | ✅ |
| `TestCloseBatch_BatchDateMatchesBahrainWindow` | same | ✅ (guard for the batch_date change) | ✅ |

```bash
cd apps/settlement && go test ./internal/scheduler/ ./internal/settlement/ -count=1
```

Existing test changed: `TestBusinessDayWindow_IgnoresClockTime` (`window_utc_compat_test.go`) —
its "end of day" instant was 23:59:59 UTC, which is the next day in Bahrain; it now uses 20:59:59
UTC (23:59:59 Bahrain). Same intent, correct timezone.
