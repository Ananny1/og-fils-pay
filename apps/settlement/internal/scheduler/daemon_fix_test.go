package scheduler

import (
	"testing"
	"time"
)

// BUG-020: the daily close must start run-delay minutes after midnight
// Asia/Bahrain (21:00 UTC), not after midnight UTC (03:00 Bahrain).
func TestDueBusinessDate_BahrainMidnight(t *testing.T) {
	const delay = 15
	cases := []struct {
		name     string
		now      time.Time // UTC
		wantDue  bool
		wantDate string
	}{
		// 00:20 Bahrain on 25 Mar: 24 Mar has just closed.
		{"just after Bahrain midnight", time.Date(2026, 3, 24, 21, 20, 0, 0, time.UTC), true, "2026-03-24"},
		// 00:10 Bahrain on 25 Mar: still inside the grace period.
		{"inside grace period", time.Date(2026, 3, 24, 21, 10, 0, 0, time.UTC), false, ""},
		// 03:15 Bahrain on 25 Mar: same business day, still 24 Mar.
		{"after UTC midnight", time.Date(2026, 3, 25, 0, 15, 0, 0, time.UTC), true, "2026-03-24"},
		// 23:59 Bahrain on 31 Dec: 30 Dec is the last completed day.
		{"year end, before midnight", time.Date(2026, 12, 31, 20, 59, 0, 0, time.UTC), true, "2026-12-30"},
		// 00:30 Bahrain on 1 Jan 2027: 31 Dec closes.
		{"year end, after midnight", time.Date(2026, 12, 31, 21, 30, 0, 0, time.UTC), true, "2026-12-31"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, due := dueBusinessDate(tc.now, delay)
			if due != tc.wantDue {
				t.Fatalf("due = %v, want %v", due, tc.wantDue)
			}
			if due && got.Format("2006-01-02") != tc.wantDate {
				t.Errorf("business date = %s, want %s", got.Format("2006-01-02"), tc.wantDate)
			}
		})
	}
}
