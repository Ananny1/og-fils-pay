package splits

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BUG-016: a split payout must pay out the whole net, to the fils.
// Delta Marketplace's weights are 50/30/20 %; net 1001 fils used to pay
// 500 + 300 + 200 = 1000 and leave 1 fils in the parent's payable forever.
func TestPayoutSplitBatch_PaysWholeNet(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set; skipping DB-backed test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	newMerchant := func() uuid.UUID {
		var id uuid.UUID
		if err := pool.QueryRow(ctx, `
			INSERT INTO merchants (display_name, mdr_bps, status, test_mode)
			VALUES ($1, 250, 'active', false) RETURNING id
		`, "split-test-"+uuid.New().String()).Scan(&id); err != nil {
			t.Fatalf("insert merchant: %v", err)
		}
		return id
	}
	parent := newMerchant()
	for _, w := range []int64{5000, 3000, 2000} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps)
			VALUES ($1, $2, $3)
		`, parent, newMerchant(), w); err != nil {
			t.Fatalf("insert split child: %v", err)
		}
	}

	const net = 1001
	var batchID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at)
		VALUES ($1, $2, 'closed', $3, 0, $3, now()) RETURNING id
	`, parent, time.Date(2026, 3, 24, 0, 0, 0, 0, time.UTC), net).Scan(&batchID); err != nil {
		t.Fatalf("insert batch: %v", err)
	}

	res, err := PayoutSplitBatch(ctx, pool, batchID)
	if err != nil {
		t.Fatalf("PayoutSplitBatch: %v", err)
	}
	var shareSum int64
	for _, s := range res.Shares {
		shareSum += int64(s.AllocatedFils)
	}
	if shareSum != net {
		t.Errorf("result shares sum = %d, want net %d", shareSum, net)
	}

	var splitSum, ledgerSum int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(allocated_fils), 0) FROM settlement_batch_splits WHERE settlement_batch_id = $1
	`, batchID).Scan(&splitSum); err != nil {
		t.Fatalf("sum splits: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_fils), 0) FROM ledger_entries
		 WHERE settlement_batch_id = $1 AND account_id = 'merchant_payable' AND direction = 'debit'
	`, batchID).Scan(&ledgerSum); err != nil {
		t.Fatalf("sum ledger: %v", err)
	}
	if splitSum != net || ledgerSum != net {
		t.Fatalf("paid out splits=%d ledger=%d, want both %d", splitSum, ledgerSum, net)
	}
}
