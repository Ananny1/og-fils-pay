package scheduler

import (
	"testing"
	"time"
)

// BUG-020: the daily close must start DaemonRunDelayMinutes after Bahrain
// midnight (21:00 UTC), not after UTC midnight (03:00 Bahrain).
func TestDueBusinessDate_ClosesAfterBahrainMidnight(t *testing.T) {
	// 22:30 UTC on 24 Mar = 01:30 Bahrain on 25 Mar: business day 24 Mar is over.
	now := time.Date(2026, 3, 24, 22, 30, 0, 0, time.UTC)
	date, due := dueBusinessDate(now, 15)
	if !due {
		t.Fatalf("dueBusinessDate(%s) not due; want the 2026-03-24 close to run", now)
	}
	if got := date.Format("2006-01-02"); got != "2026-03-24" {
		t.Fatalf("business date = %s, want 2026-03-24", got)
	}
}

func TestDueBusinessDate_WaitsForGracePeriod(t *testing.T) {
	// 21:05 UTC = 00:05 Bahrain: still inside the 15-minute grace period.
	now := time.Date(2026, 3, 24, 21, 5, 0, 0, time.UTC)
	if _, due := dueBusinessDate(now, 15); due {
		t.Fatalf("dueBusinessDate(%s) due before the grace period ended", now)
	}
	// 21:20 UTC = 00:20 Bahrain: due, for 24 Mar.
	date, due := dueBusinessDate(now.Add(15*time.Minute), 15)
	if !due || date.Format("2006-01-02") != "2026-03-24" {
		t.Fatalf("at 21:20 UTC got (%s, %v), want (2026-03-24, true)", date.Format("2006-01-02"), due)
	}
}
