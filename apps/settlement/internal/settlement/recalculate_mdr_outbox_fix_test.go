package settlement

import (
	"context"
	"testing"
	"time"
)

// BUG-074: RecalculateMDR rewrote a closed batch's fee_fils/net_payout_fils
// but emitted no outbox event. Reporting's merchant_payout_trends (the
// merchant dashboard's payout figures) only learns a batch's fee and net
// from settlement.batch_closed, so it kept the pre-recalculation figures
// forever, while the bank payout used the new ones.
func TestRecalculateMDR_EmitsUpdatedBatchFigures(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	businessDate := time.Date(2026, 4, 22, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, mdrBps, 40_000, start.Add(time.Hour))

	closed, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE merchants SET mdr_bps = 300 WHERE id = $1`, merchantID); err != nil {
		t.Fatalf("update rate: %v", err)
	}
	from, to := recalcWindow(businessDate)
	result, err := RecalculateMDR(ctx, pool, merchantID, from, to)
	if err != nil || len(result.Adjusted) != 1 {
		t.Fatalf("RecalculateMDR = %+v, %v; want one adjustment", result, err)
	}
	newFee := result.Adjusted[0].NewFeeFils

	// The newest batch event for this batch (what reporting applies last)
	// must carry the recalculated fee and net.
	var fee, net int64
	if err := pool.QueryRow(ctx, `
		SELECT (payload->>'feeFils')::bigint, (payload->>'netPayoutFils')::bigint
		  FROM outbox_events
		 WHERE event_type = 'settlement.batch_closed' AND aggregate_id = $1
		 ORDER BY id DESC LIMIT 1
	`, closed.BatchID).Scan(&fee, &net); err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	if fee != int64(newFee) || net != int64(closed.GrossFils-newFee) {
		t.Errorf("latest batch event fee/net = %d/%d, want %d/%d (reporting keeps the old figures)",
			fee, net, newFee, closed.GrossFils-newFee)
	}
}
