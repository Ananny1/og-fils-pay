package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// insertPostedCredit writes one posted manual credit exactly the way
// apps/api/src/admin/credits.ts postCreditToLedger does: the credit_requests
// row, the merchant_payable credit legs dated at the effective date's
// Bahrain midnight, and the merchant_balances cache bump.
func insertPostedCredit(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, baseFils, feeReversalFils money.Fils, effectiveDate string, postedAt time.Time) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var adminID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO admin_users (email, password_hash, display_name, role)
		VALUES ($1, 'x', 'credit test', 'finance') RETURNING id
	`, "credit-test-"+uuid.New().String()+"@example.test").Scan(&adminID); err != nil {
		t.Fatalf("insert admin: %v", err)
	}
	group := uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES ($1, $2, 'merchant_credit_contra', 'debit',  $3, ($4::date)::timestamp AT TIME ZONE 'Asia/Bahrain', 'manual credit: base'),
		       ($1, $2, 'merchant_payable',       'credit', $3, ($4::date)::timestamp AT TIME ZONE 'Asia/Bahrain', 'manual credit: base')
	`, group, merchantID, int64(baseFils), effectiveDate); err != nil {
		t.Fatalf("insert credit legs: %v", err)
	}
	if feeReversalFils > 0 {
		if _, err := pool.Exec(ctx, `
			INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
			VALUES ($1, $2, 'platform_fee_revenue', 'debit',  $3, ($4::date)::timestamp AT TIME ZONE 'Asia/Bahrain', 'manual credit: MDR reversal'),
			       ($1, $2, 'merchant_payable',     'credit', $3, ($4::date)::timestamp AT TIME ZONE 'Asia/Bahrain', 'manual credit: MDR reversal')
		`, group, merchantID, int64(feeReversalFils), effectiveDate); err != nil {
			t.Fatalf("insert credit fee legs: %v", err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (merchant_id) DO UPDATE
		  SET cached_payable_fils = merchant_balances.cached_payable_fils + EXCLUDED.cached_payable_fils
	`, merchantID, int64(baseFils+feeReversalFils)); err != nil {
		t.Fatalf("bump cache: %v", err)
	}
	var id uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO credit_requests (merchant_id, requested_by_admin_user_id, requested_by_display_name, reason_code,
		                             base_amount_fils, fee_reversal_fils, effective_date, requires_approval,
		                             status, posted_at, ledger_entry_group_id)
		VALUES ($1, $2, 'credit test', 'goodwill', $3, $4, $5, false, 'posted', $6, $7)
		RETURNING id
	`, merchantID, adminID, int64(baseFils), int64(feeReversalFils), effectiveDate, postedAt, group).Scan(&id); err != nil {
		t.Fatalf("insert credit_requests: %v", err)
	}
	return id
}

func merchantPayableLedger(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID) money.Fils {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)
		  FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'merchant_payable'
	`, merchantID).Scan(&bal); err != nil {
		t.Fatalf("ledger balance: %v", err)
	}
	return money.Fils(bal)
}

// BUG-070: a posted manual credit is owed to the merchant (it sits in
// merchant_payable), so the next batch must pay it out — exactly once — and
// after the payout the merchant owes/is owed nothing.
func TestCloseBatch_PaysOutPostedCredit(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	day := time.Date(2026, 5, 6, 0, 0, 0, 0, time.UTC)
	start, end := BusinessDayWindow(day)
	// insertCaptureEvent also posts the capture's ledger legs.
	_, fee := insertCaptureEvent(t, pool, merchantID, mdrBps, 10_000, start.Add(1*time.Hour))

	// A goodwill credit for a dispute last month, posted during the day.
	creditID := insertPostedCredit(t, pool, merchantID, 5_125, 125, "2026-04-20", start.Add(2*time.Hour))
	// A credit posted after the day ended belongs to the next batch.
	lateID := insertPostedCredit(t, pool, merchantID, 7_000, 0, "2026-05-06", end.Add(1*time.Minute))

	closed, err := CloseBatch(ctx, pool, merchantID, day)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	want := money.Fils(10_000) - fee + 5_125 + 125
	if closed.NetPayoutFils != want {
		t.Fatalf("NetPayoutFils = %d, want %d (gross - fee + posted credit): the credit is never paid out", closed.NetPayoutFils, want)
	}
	if _, err := PayoutBatch(ctx, pool, closed.BatchID); err != nil {
		t.Fatalf("PayoutBatch: %v", err)
	}

	// Only the late credit is still owed, in the ledger and in the cache.
	if got := merchantPayableLedger(t, pool, merchantID); got != 7_000 {
		t.Errorf("merchant_payable after payout = %d, want 7000 (only the late credit left)", got)
	}
	var cached int64
	if err := pool.QueryRow(ctx, `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, merchantID).Scan(&cached); err != nil {
		t.Fatalf("read cache: %v", err)
	}
	if cached != 7_000 {
		t.Errorf("cached_payable_fils after payout = %d, want 7000", cached)
	}

	var claimedBy, lateBy *uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT settlement_batch_id FROM credit_requests WHERE id = $1`, creditID).Scan(&claimedBy); err != nil {
		t.Fatalf("read credit: %v", err)
	}
	if claimedBy == nil || *claimedBy != closed.BatchID {
		t.Errorf("credit settlement_batch_id = %v, want %s", claimedBy, closed.BatchID)
	}
	if err := pool.QueryRow(ctx, `SELECT settlement_batch_id FROM credit_requests WHERE id = $1`, lateID).Scan(&lateBy); err != nil {
		t.Fatalf("read late credit: %v", err)
	}
	if lateBy != nil {
		t.Errorf("late credit claimed by %s, want unbatched", *lateBy)
	}

	// Next day: the late credit is paid, the first one is not paid again.
	next, err := CloseBatch(ctx, pool, merchantID, day.AddDate(0, 0, 1))
	if err != nil {
		t.Fatalf("CloseBatch next day: %v", err)
	}
	if next.NetPayoutFils != 7_000 {
		t.Errorf("next-day net = %d, want 7000 (late credit only, earlier credit not paid twice)", next.NetPayoutFils)
	}
}
