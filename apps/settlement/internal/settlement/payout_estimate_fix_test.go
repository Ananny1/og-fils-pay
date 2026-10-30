package settlement

import (
	"context"
	"testing"

	"github.com/filspay/settlement/internal/money"
)

// BUG-028: the lifetime payout total was accumulated as float32 into a REAL
// column, so it drifts once a merchant has paid out more than ~16,777 BD.
func TestUpdateLifetimePayoutMonitoringEstimate_LargeValuesExact(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 250)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var want int64
	for _, net := range []money.Fils{16_777_217, 1, 123_456_789, 3} {
		if err := UpdateLifetimePayoutMonitoringEstimate(ctx, tx, merchantID, net); err != nil {
			t.Fatalf("UpdateLifetimePayoutMonitoringEstimate(%d): %v", net, err)
		}
		want += int64(net)
	}

	var got string
	if err := tx.QueryRow(ctx, `
		SELECT lifetime_net_payout_monitoring_estimate::numeric::text FROM merchants WHERE id = $1
	`, merchantID).Scan(&got); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if got != "140234010" {
		t.Fatalf("lifetime estimate = %s, want exactly %d", got, want)
	}
}
