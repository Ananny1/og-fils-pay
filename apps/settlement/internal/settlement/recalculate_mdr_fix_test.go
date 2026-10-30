package settlement

import (
	"context"
	"testing"
	"time"
)

// BUG-018: RecalculateMDR selected every batch with status <> 'open', which
// includes 'paid'. It rewrote fee_fils / net_payout_fils of batches whose
// money had already left, so the frozen record no longer matched the payout.
func TestRecalculateMDR_LeavesPaidBatchesUntouched(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const originalMdrBps = 250
	merchantID := insertActiveMerchant(t, pool, originalMdrBps)

	businessDate := time.Date(2026, 4, 6, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, originalMdrBps, 40_000, start.Add(time.Hour))

	closed, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if _, err := PayoutBatch(ctx, pool, closed.BatchID); err != nil {
		t.Fatalf("PayoutBatch: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE merchants SET mdr_bps = 300 WHERE id = $1`, merchantID); err != nil {
		t.Fatalf("update mdr_bps: %v", err)
	}

	from, to := recalcWindow(businessDate)
	result, err := RecalculateMDR(ctx, pool, merchantID, from, to)
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if len(result.Adjusted) != 0 {
		t.Errorf("adjusted %d batches, want 0 (the only batch is already paid)", len(result.Adjusted))
	}

	var fee, net int64
	if err := pool.QueryRow(ctx, `SELECT fee_fils, net_payout_fils FROM settlement_batches WHERE id = $1`, closed.BatchID).Scan(&fee, &net); err != nil {
		t.Fatal(err)
	}
	if fee != int64(closed.FeeFils) || net != int64(closed.NetPayoutFils) {
		t.Errorf("paid batch rewritten: fee %d net %d, want fee %d net %d as paid", fee, net, closed.FeeFils, closed.NetPayoutFils)
	}
	var adjustments int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM ledger_entries WHERE settlement_batch_id = $1 AND description = 'MDR recalculation adjustment'
	`, closed.BatchID).Scan(&adjustments); err != nil {
		t.Fatal(err)
	}
	if adjustments != 0 {
		t.Errorf("posted %d adjustment legs against a paid batch, want 0", adjustments)
	}
}
