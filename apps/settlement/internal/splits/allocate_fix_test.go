package splits

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// BUG-016: each child's share was ApplyRateFils(net, weight), rounded on
// its own, so the children did not add up to the parent's net payout. The
// missing (or extra) fils stayed in the parent's merchant_payable forever.
func TestChildShares_SumToNetWithRemainders(t *testing.T) {
	cases := []struct {
		name       string
		netPayout  money.Fils
		weightsBps []int64
	}{
		{"thirds", 10_001, []int64{3333, 3333, 3334}},
		{"thirds small", 100, []int64{3333, 3333, 3334}},
		{"halves odd", 10_001, []int64{5000, 5000}},
		{"seven ways", 999_999, []int64{1428, 1428, 1428, 1429, 1429, 1429, 1429}},
		{"weights not 10000", 10_000, []int64{2500, 2500}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			children := make([]ChildWeight, len(tc.weightsBps))
			for i, w := range tc.weightsBps {
				children[i] = ChildWeight{WeightBps: w}
			}
			shares := ChildShares(tc.netPayout, children)
			var total money.Fils
			for _, s := range shares {
				if s < 0 {
					t.Errorf("negative share %d", s)
				}
				total += s
			}
			if total != tc.netPayout {
				t.Errorf("sum of shares %d != net payout %d (shares %v)", total, tc.netPayout, shares)
			}
		})
	}
}

func mustPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set; skipping DB-backed test (run against a real, migrated Postgres)")
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatalf("failed to connect to DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func insertMerchant(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO merchants (display_name, mdr_bps, status, test_mode)
		VALUES ($1, 250, 'active', false) RETURNING id
	`, "splits-test-"+uuid.New().String()).Scan(&id)
	if err != nil {
		t.Fatalf("insertMerchant: %v", err)
	}
	return id
}

// seedClosedSplitBatch creates a parent with three 1/3 children and a closed
// batch whose net payout is already credited to the parent's
// merchant_payable (as capture + close would have left it).
func seedClosedSplitBatch(t *testing.T, pool *pgxpool.Pool, net int64) (parent, batchID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	parent = insertMerchant(t, pool)
	for _, w := range []int64{3333, 3333, 3334} {
		child := insertMerchant(t, pool)
		if _, err := pool.Exec(ctx, `
			INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps) VALUES ($1, $2, $3)
		`, parent, child, w); err != nil {
			t.Fatalf("insert split child: %v", err)
		}
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at)
		VALUES ($1, '2026-09-14', 'closed', $2, 0, $2, now()) RETURNING id
	`, parent, net).Scan(&batchID); err != nil {
		t.Fatalf("insert batch: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES ($1, $2, 'card_scheme_clearing', 'debit', $3, now(), 'capture: gross'),
		       ($1, $2, 'merchant_payable', 'credit', $3, now(), 'capture: gross')
	`, uuid.New(), parent, net); err != nil {
		t.Fatalf("insert capture legs: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO merchant_balances (merchant_id, cached_payable_fils, last_settlement_batch_id, updated_at)
		VALUES ($1, $2, $3, now())
	`, parent, net, batchID); err != nil {
		t.Fatalf("seed balance cache: %v", err)
	}
	return parent, batchID
}

func TestPayoutSplitBatch_ChildrenAddUpToNet(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const net = 10_001
	parent, batchID := seedClosedSplitBatch(t, pool, net)

	if _, err := PayoutSplitBatch(ctx, pool, batchID); err != nil {
		t.Fatalf("PayoutSplitBatch: %v", err)
	}

	var allocated int64
	if err := pool.QueryRow(ctx, `SELECT COALESCE(SUM(allocated_fils), 0) FROM settlement_batch_splits WHERE settlement_batch_id = $1`, batchID).Scan(&allocated); err != nil {
		t.Fatal(err)
	}
	if allocated != net {
		t.Errorf("children allocated %d, want the full net payout %d", allocated, net)
	}
	var payable, cached int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)
		  FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'merchant_payable'
	`, parent).Scan(&payable); err != nil {
		t.Fatal(err)
	}
	if payable != 0 {
		t.Errorf("parent merchant_payable after split payout = %d, want 0 (fils stuck)", payable)
	}
	if err := pool.QueryRow(ctx, `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, parent).Scan(&cached); err != nil {
		t.Fatal(err)
	}
	if cached != 0 {
		t.Errorf("parent cached balance after split payout = %d, want 0", cached)
	}
}
