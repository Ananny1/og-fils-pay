package settlement

import (
	"context"
	"testing"
	"time"
)

// BUG-020: an instant late in the UTC day (after 21:00 UTC) is already the
// next calendar day in Bahrain. BusinessDayWindow took the UTC date, so the
// daemon's "today" only flipped at 03:00 Bahrain.
func TestBusinessDayWindow_UsesBahrainDateOfInstant(t *testing.T) {
	start, end := BusinessDayWindow(time.Date(2026, 3, 24, 22, 0, 0, 0, time.UTC)) // 01:00 Bahrain, 25 Mar
	wantStart := time.Date(2026, 3, 24, 21, 0, 0, 0, time.UTC)
	wantEnd := time.Date(2026, 3, 25, 21, 0, 0, 0, time.UTC)
	if !start.Equal(wantStart) || !end.Equal(wantEnd) {
		t.Fatalf("window = [%s, %s), want [%s, %s)", start.UTC(), end.UTC(), wantStart, wantEnd)
	}
}

// A capture at 22:30 UTC on 24 Mar is 01:30 Bahrain on 25 Mar: it belongs
// to the 25 Mar batch, and the batch_date must match the window it covers.
func TestCloseBatch_BatchDateMatchesBahrainWindow(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 250)
	insertCaptureEvent(t, pool, merchantID, 250, 5000, time.Date(2026, 3, 24, 22, 30, 0, 0, time.UTC))

	// The daemon passes an instant; at 00:20 Bahrain on 26 Mar the day that
	// just closed is 25 Mar.
	bahrain, _ := time.LoadLocation("Asia/Bahrain")
	businessDate := time.Date(2026, 3, 25, 0, 0, 0, 0, bahrain)
	result, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if got := result.BatchDate.Format("2006-01-02"); got != "2026-03-25" {
		t.Errorf("batch_date = %s, want 2026-03-25", got)
	}
	if result.EventCount != 1 {
		t.Errorf("events = %d, want 1 (01:30 Bahrain on 25 Mar)", result.EventCount)
	}
}
