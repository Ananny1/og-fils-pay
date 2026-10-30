package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// insertImportedAdjustment writes one CSV adjustment row exactly the way
// apps/api/src/admin/adjustmentImport.ts applyAdjustmentImport does: the
// manual_balance_adjustment_contra / merchant_payable legs
// (ledgerAdjustments.ts), the merchant_balances cache bump by the signed
// amount, and the adjustment_import_rows record.
func insertImportedAdjustment(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, amountFils int64, createdAt time.Time) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var adminID, importID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO admin_users (email, password_hash, display_name, role)
		VALUES ($1, 'x', 'adjustment test', 'finance') RETURNING id
	`, "adjustment-test-"+uuid.New().String()+"@example.test").Scan(&adminID); err != nil {
		t.Fatalf("insert admin: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO adjustment_imports (uploaded_by_admin_user_id, original_filename, row_count, content_hash)
		VALUES ($1, 'fix.csv', 1, $2) RETURNING id
	`, adminID, uuid.New().String()).Scan(&importID); err != nil {
		t.Fatalf("insert import: %v", err)
	}
	group := uuid.New()
	debit, credit := "manual_balance_adjustment_contra", "merchant_payable"
	magnitude := amountFils
	if amountFils < 0 {
		debit, credit = credit, debit
		magnitude = -amountFils
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES ($1, $2, $3, 'debit',  $5, $6, 'CSV adjustment import'),
		       ($1, $2, $4, 'credit', $5, $6, 'CSV adjustment import')
	`, group, merchantID, debit, credit, magnitude, createdAt); err != nil {
		t.Fatalf("insert adjustment legs: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (merchant_id) DO UPDATE
		  SET cached_payable_fils = merchant_balances.cached_payable_fils + EXCLUDED.cached_payable_fils
	`, merchantID, amountFils); err != nil {
		t.Fatalf("bump cache: %v", err)
	}
	var id uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO adjustment_import_rows
		  (adjustment_import_id, row_number, merchant_id, raw_amount_text, parsed_amount_fils, reason, ledger_entry_group_id, created_at)
		VALUES ($1, 1, $2, 'x', $3, 'fix', $4, $5)
		RETURNING id
	`, importID, merchantID, amountFils, group, createdAt).Scan(&id); err != nil {
		t.Fatalf("insert adjustment_import_rows: %v", err)
	}
	return id
}

// BUG-105: an imported adjustment is posted to merchant_payable, so the
// next batch must pay a positive one out and deduct a negative one —
// exactly once, never making the payout negative (what doesn't fit waits).
func TestCloseBatch_SettlesImportedAdjustments(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	day := time.Date(2026, 5, 7, 0, 0, 0, 0, time.UTC)
	start, end := BusinessDayWindow(day)
	_, fee := insertCaptureEvent(t, pool, merchantID, mdrBps, 10_000, start.Add(1*time.Hour))

	insertImportedAdjustment(t, pool, merchantID, 3_000, start.Add(2*time.Hour))
	insertImportedAdjustment(t, pool, merchantID, -2_000, start.Add(3*time.Hour))
	// Too big for today's payout: carried forward, not paid as a negative.
	bigID := insertImportedAdjustment(t, pool, merchantID, -50_000, start.Add(4*time.Hour))
	// Imported after the day ended: next day's batch.
	insertImportedAdjustment(t, pool, merchantID, 4_000, end.Add(1*time.Minute))

	closed, err := CloseBatch(ctx, pool, merchantID, day)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	want := money.Fils(10_000) - fee + 3_000 - 2_000
	if closed.NetPayoutFils != want {
		t.Fatalf("NetPayoutFils = %d, want %d (gross - fee + 3000 - 2000): imported adjustments are never settled", closed.NetPayoutFils, want)
	}
	if _, err := PayoutBatch(ctx, pool, closed.BatchID); err != nil {
		t.Fatalf("PayoutBatch: %v", err)
	}

	// Left owed: the carried -50000 and the late +4000, in ledger and cache.
	if got := merchantPayableLedger(t, pool, merchantID); got != -46_000 {
		t.Errorf("merchant_payable after payout = %d, want -46000", got)
	}
	var cached int64
	if err := pool.QueryRow(ctx, `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, merchantID).Scan(&cached); err != nil {
		t.Fatalf("read cache: %v", err)
	}
	if cached != -46_000 {
		t.Errorf("cached_payable_fils after payout = %d, want -46000 (cache must match the ledger)", cached)
	}

	// Re-closing the same day is a no-op.
	again, err := CloseBatch(ctx, pool, merchantID, day)
	if err != nil {
		t.Fatalf("CloseBatch again: %v", err)
	}
	if !again.AlreadyClosed {
		t.Errorf("second CloseBatch should be a no-op")
	}

	// Next day: the late +4000 is paid; -50000 still doesn't fit and waits.
	next, err := CloseBatch(ctx, pool, merchantID, day.AddDate(0, 0, 1))
	if err != nil {
		t.Fatalf("CloseBatch next day: %v", err)
	}
	if next.NetPayoutFils != 4_000 {
		t.Errorf("next-day net = %d, want 4000 (late adjustment only, nothing paid twice)", next.NetPayoutFils)
	}
	var bigBy *uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT settlement_batch_id FROM adjustment_import_rows WHERE id = $1`, bigID).Scan(&bigBy); err != nil {
		t.Fatalf("read big adjustment: %v", err)
	}
	if bigBy != nil {
		t.Errorf("-50000 adjustment claimed by %s, want carried forward", *bigBy)
	}
}
