package settlement

import (
	"context"
	"testing"
	"time"
)

// BUG-072: once the platform passes the volume tier (2,000,000 BD),
// CloseBatch takes 15 bps off every merchant's rate. RecalculateMDR re-rated
// the same batch without that bonus, so a recalculation with NO rate change
// charged the merchant 15 bps more.
func TestRecalculateMDR_KeepsVolumeTierBonus(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()

	var saved int64
	if err := pool.QueryRow(ctx, `SELECT total_processed_fils FROM platform_stats WHERE id = 1`).Scan(&saved); err != nil {
		t.Fatalf("read platform_stats: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `UPDATE platform_stats SET total_processed_fils = $1 WHERE id = 1`, saved) //nolint:errcheck
	})
	if _, err := pool.Exec(ctx, `UPDATE platform_stats SET total_processed_fils = 2000000000 WHERE id = 1`); err != nil {
		t.Fatalf("set platform_stats: %v", err)
	}

	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, mdrBps-15, 40_000, start.Add(time.Hour))

	closed, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if want := ComputeSettlementFee(40_000, mdrBps-15, 0); closed.FeeFils != want {
		t.Fatalf("close fee = %d, want %d (tier bonus applied)", closed.FeeFils, want)
	}

	from, to := recalcWindow(businessDate)
	result, err := RecalculateMDR(ctx, pool, merchantID, from, to)
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if len(result.Adjusted) != 0 {
		a := result.Adjusted[0]
		t.Fatalf("recalc with no rate change adjusted fee %d -> %d (diff %d); want no adjustment (tier bonus dropped)",
			a.OldFeeFils, a.NewFeeFils, a.DiffFils)
	}
}
