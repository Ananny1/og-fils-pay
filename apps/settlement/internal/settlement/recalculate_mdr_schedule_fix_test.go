package settlement

import (
	"context"
	"testing"
	"time"
)

// BUG-065: a merchant whose rate lives in fee_schedules (seed: beta-digital,
// merchants.mdr_bps 180 = fallback, 165 effective from 2026-09-06). CloseBatch
// charges the schedule rate; RecalculateMDR re-rated the same batch at the
// fallback merchants.mdr_bps, so a recalculation with NO rate change charged
// the merchant the old 180 bps again.
func TestRecalculateMDR_UsesFeeScheduleRate(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const fallbackMdrBps = 180
	const scheduledMdrBps = 165
	merchantID := insertActiveMerchant(t, pool, fallbackMdrBps)

	businessDate := time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertFeeSchedule(t, pool, merchantID, fallbackMdrBps, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	insertFeeSchedule(t, pool, merchantID, scheduledMdrBps, time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC))
	insertCaptureEvent(t, pool, merchantID, scheduledMdrBps, 40_000, start.Add(time.Hour))

	closed, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if want := ComputeSettlementFee(40_000, scheduledMdrBps, 0); closed.FeeFils != want {
		t.Fatalf("close fee = %d, want %d (schedule rate)", closed.FeeFils, want)
	}

	from, to := recalcWindow(businessDate)
	result, err := RecalculateMDR(ctx, pool, merchantID, from, to)
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if len(result.Adjusted) != 0 {
		a := result.Adjusted[0]
		t.Fatalf("recalc with no rate change adjusted fee %d -> %d (diff %d); want no adjustment (rate is the 165 bps schedule, not the 180 bps fallback)",
			a.OldFeeFils, a.NewFeeFils, a.DiffFils)
	}

	// A real rate change is a new fee_schedules row; recalc applies it.
	insertFeeSchedule(t, pool, merchantID, 150, time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC))
	result, err = RecalculateMDR(ctx, pool, merchantID, from, to)
	if err != nil {
		t.Fatalf("RecalculateMDR after new schedule: %v", err)
	}
	if want := ComputeSettlementFee(40_000, 150, 0); len(result.Adjusted) != 1 || result.Adjusted[0].NewFeeFils != want {
		t.Fatalf("recalc after new schedule = %+v, want one adjustment to fee %d", result.Adjusted, want)
	}
}
