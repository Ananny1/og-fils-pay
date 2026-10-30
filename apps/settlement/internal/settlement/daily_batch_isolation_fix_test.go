package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func insertActiveMerchantWithID(t *testing.T, pool *pgxpool.Pool, id uuid.UUID, mdrBps int64) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO merchants (id, display_name, mdr_bps, status, test_mode)
		VALUES ($1, $2, $3, 'active', false)
	`, id, "settlement-isolation-test-"+id.String(), mdrBps); err != nil {
		t.Fatalf("insert merchant: %v", err)
	}
}

// BUG-073: RunDailyBatch returned on the first merchant whose close failed,
// so every merchant after it (in id order) was never closed or paid for that
// day — and the daemon only ever retries "yesterday", so those captures were
// left out of every payout.
func TestRunDailyBatch_OneFailingMerchantDoesNotBlockOthers(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250

	suffix := uuid.New().String()[8:]
	badID := uuid.MustParse("00000000" + suffix)  // sorts first
	goodID := uuid.MustParse("ffffffff" + suffix) // sorts last
	insertActiveMerchantWithID(t, pool, badID, mdrBps)
	insertActiveMerchantWithID(t, pool, goodID, mdrBps)

	day := time.Date(2026, 3, 3, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(day)
	// 100,000,000 BD does not fit scheme_export_lines.amount NUMERIC(10,2):
	// this merchant's CloseBatch fails.
	insertCaptureEvent(t, pool, badID, mdrBps, 100_000_000_000, start.Add(time.Hour))
	insertCaptureEvent(t, pool, goodID, mdrBps, 10_000, start.Add(time.Hour))

	_, err := RunDailyBatch(ctx, pool, day, nil)
	if err == nil {
		t.Errorf("RunDailyBatch error = nil, want the failing merchant reported")
	}

	var status string
	if err := pool.QueryRow(ctx, `
		SELECT status FROM settlement_batches WHERE merchant_id = $1 AND batch_date = $2
	`, goodID, day).Scan(&status); err != nil {
		t.Fatalf("healthy merchant has no batch for the day (blocked by the failing one): %v", err)
	}
	if status != "paid" {
		t.Errorf("healthy merchant batch status = %q, want paid", status)
	}
}
