package internalapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

// BUG-017: the admin console "Rebuild cached balances" button must give the
// same answer as the CLI `rebuild-balances` (ledger.RebuildAllBalances): the
// merchant_payable position in ledger_entries. It read the
// merchant_payable_position view (sum of scheme export lines: gross only,
// no fees, no payouts) instead.
func TestRebuildBalances_UsesLedgerNotSchemeLines(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	server := newTestServer(t, pool)

	merchantID := insertActiveMerchant(t, pool)
	txnID := insertCaptureEvent(t, pool, merchantID, 12000, time.Date(2026, 4, 13, 9, 0, 0, 0, time.UTC))

	// MDR fee leg as capture.ts posts it: ledger payable is now 11700.
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES ($1, $2, $3, 'merchant_payable', 'debit', 300, now(), 'capture: MDR fee'),
		       ($1, $2, $3, 'platform_fee_revenue', 'credit', 300, now(), 'capture: MDR fee')
	`, uuid.New(), merchantID, txnID); err != nil {
		t.Fatalf("insert fee legs: %v", err)
	}
	var batchID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at)
		VALUES ($1, '2026-04-13', 'closed', 12000, 300, 11700, now()) RETURNING id
	`, merchantID).Scan(&batchID); err != nil {
		t.Fatalf("seed batch: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO scheme_export_lines (settlement_batch_id, transaction_id, amount_fils, line_sequence)
		VALUES ($1, $2, 12000, 1)
	`, batchID, txnID); err != nil {
		t.Fatalf("seed scheme line: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at) VALUES ($1, 1, now())
	`, merchantID); err != nil {
		t.Fatalf("seed cache: %v", err)
	}

	resp := post(t, server, "/internal/rebuild-balances", "Bearer "+testToken, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var diffs map[string]rebuildDiffResponse
	decodeJSON(t, resp, &diffs)
	diff, ok := diffs[merchantID.String()]
	if !ok {
		t.Fatalf("no diff for merchant %s", merchantID)
	}
	if diff.After != 11700 {
		t.Errorf("after = %d, want 11700 (ledger merchant_payable: 12000 gross - 300 fee)", diff.After)
	}
}
