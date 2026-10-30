package balances

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BUG-053: a merchant with no merchant_balances row (a split child) must
// still have the payout recorded, not silently skipped.
func TestApplyPayout_NoBalanceRow(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set; skipping DB-backed test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	var merchantID uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
		"BUG-053 "+uuid.NewString()).Scan(&merchantID); err != nil {
		t.Fatalf("insert merchant: %v", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := ApplyPayout(ctx, tx, merchantID, uuid.New(), 1500); err != nil {
		t.Fatalf("ApplyPayout: %v", err)
	}
	if err := ApplyPayout(ctx, tx, merchantID, uuid.New(), 500); err != nil {
		t.Fatalf("ApplyPayout: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	var cached int64
	if err := pool.QueryRow(ctx,
		`SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, merchantID).Scan(&cached); err != nil {
		t.Fatalf("no balance row after payout: %v", err)
	}
	if cached != -2000 {
		t.Fatalf("cached_payable_fils = %d, want -2000", cached)
	}
}
