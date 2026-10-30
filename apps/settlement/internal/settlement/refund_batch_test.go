package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// insertRefund inserts one succeeded refunds row the way apps/api's
// processRefund.ts writes it (FP-300.3 tests).
func insertRefund(t *testing.T, pool *pgxpool.Pool, merchantID, txnID uuid.UUID, amountFils, feeReversedFils money.Fils, occurredAt time.Time) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO refunds (transaction_id, merchant_id, amount_fils, fee_reversed_fils, status,
		                     acquirer_reference, reason, created_by_type, created_by_id, occurred_at)
		VALUES ($1, $2, $3, $4, 'succeeded', $5, 'test', 'merchant_api_key', $6, $7)
		RETURNING id
	`, txnID, merchantID, int64(amountFils), int64(feeReversedFils), "acq-refund-"+uuid.New().String(), uuid.New(), occurredAt).Scan(&id)
	if err != nil {
		t.Fatalf("insertRefund: %v", err)
	}
	return id
}

func refundBatchID(t *testing.T, pool *pgxpool.Pool, refundID uuid.UUID) *uuid.UUID {
	t.Helper()
	var batchID *uuid.UUID
	if err := pool.QueryRow(context.Background(), `SELECT settlement_batch_id FROM refunds WHERE id = $1`, refundID).Scan(&batchID); err != nil {
		t.Fatalf("refundBatchID: %v", err)
	}
	return batchID
}

// FP-300.3 (Q-2): a refund is deducted from the merchant's next batch.
func TestCloseBatch_DeductsRefundsFromNet(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	businessDate := time.Date(2026, 4, 10, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	txnID, fee := insertCaptureEvent(t, pool, merchantID, mdrBps, 10_000, start.Add(1*time.Hour))
	refundID := insertRefund(t, pool, merchantID, txnID, 4_000, 100, start.Add(3*time.Hour))

	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	want := money.Fils(10_000) - fee - (4_000 - 100)
	if result.NetPayoutFils != want {
		t.Errorf("NetPayoutFils = %d, want %d (gross - fee - (refund - fee reversed))", result.NetPayoutFils, want)
	}
	if result.RefundCount != 1 || result.RefundDeductedFils != 3_900 {
		t.Errorf("RefundCount/RefundDeductedFils = %d/%d, want 1/3900", result.RefundCount, result.RefundDeductedFils)
	}
	if got := refundBatchID(t, pool, refundID); got == nil || *got != result.BatchID {
		t.Errorf("refund settlement_batch_id = %v, want %s", got, result.BatchID)
	}

	var storedNet int64
	if err := pool.QueryRow(context.Background(), `SELECT net_payout_fils FROM settlement_batches WHERE id = $1`, result.BatchID).Scan(&storedNet); err != nil {
		t.Fatalf("read batch: %v", err)
	}
	if money.Fils(storedNet) != want {
		t.Errorf("stored net_payout_fils = %d, want %d", storedNet, want)
	}

	// Re-closing is a no-op: the refund is never deducted twice.
	again, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch again: %v", err)
	}
	if !again.AlreadyClosed || again.NetPayoutFils != want {
		t.Errorf("re-close = %+v, want AlreadyClosed with net %d", again, want)
	}
}

// A refund bigger than one day's net is carried to a later batch instead of
// driving a payout below zero, and is deducted exactly once.
func TestCloseBatch_RefundLargerThanNetCarriesForward(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	day1 := time.Date(2026, 4, 12, 0, 0, 0, 0, time.UTC)
	day2 := day1.AddDate(0, 0, 1)
	start1, _ := BusinessDayWindow(day1)
	start2, _ := BusinessDayWindow(day2)

	oldTxn, _ := insertCaptureEvent(t, pool, merchantID, mdrBps, 2_000, start1.Add(-48*time.Hour))
	_, fee1 := insertCaptureEvent(t, pool, merchantID, mdrBps, 1_000, start1.Add(1*time.Hour))
	refundID := insertRefund(t, pool, merchantID, oldTxn, 2_000, 50, start1.Add(2*time.Hour))

	r1, err := CloseBatch(context.Background(), pool, merchantID, day1)
	if err != nil {
		t.Fatalf("CloseBatch day1: %v", err)
	}
	if r1.NetPayoutFils != money.Fils(1_000)-fee1 || r1.RefundCount != 0 {
		t.Errorf("day1 net/refunds = %d/%d, want %d/0 (refund does not fit, carried)", r1.NetPayoutFils, r1.RefundCount, money.Fils(1_000)-fee1)
	}
	if got := refundBatchID(t, pool, refundID); got != nil {
		t.Errorf("refund claimed by day1 batch %s, want unbatched", *got)
	}

	_, fee2 := insertCaptureEvent(t, pool, merchantID, mdrBps, 5_000, start2.Add(1*time.Hour))
	r2, err := CloseBatch(context.Background(), pool, merchantID, day2)
	if err != nil {
		t.Fatalf("CloseBatch day2: %v", err)
	}
	want := money.Fils(5_000) - fee2 - (2_000 - 50)
	if r2.NetPayoutFils != want || r2.RefundCount != 1 {
		t.Errorf("day2 net/refunds = %d/%d, want %d/1", r2.NetPayoutFils, r2.RefundCount, want)
	}
	if got := refundBatchID(t, pool, refundID); got == nil || *got != r2.BatchID {
		t.Errorf("refund settlement_batch_id = %v, want day2 batch %s", got, r2.BatchID)
	}
}
