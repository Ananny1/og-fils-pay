package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/filspay/settlement/internal/money"
)

// BUG-041: ADR-0002 says CloseBatch journals each export line's rounding
// residue (gross_fils - amount_fils): card_scheme_clearing credit /
// scheme_rounding_residue debit. Nothing posted it.
func TestCloseBatch_JournalsSchemeRoundingResidue(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 3, 26, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	// residues: 7 + 5 + 0 = 12 fils
	for i, amount := range []money.Fils{4747, 93275, 4740} {
		insertCaptureEvent(t, pool, merchantID, mdrBps, amount, start.Add(time.Duration(i+1)*time.Hour))
	}
	result, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}

	var residueDebit, clearingCredit, groups int64
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_fils) FILTER (WHERE account_id = 'scheme_rounding_residue' AND direction = 'debit'), 0),
		       COALESCE(SUM(amount_fils) FILTER (WHERE account_id = 'card_scheme_clearing' AND direction = 'credit'), 0),
		       COUNT(DISTINCT entry_group_id)
		  FROM ledger_entries
		 WHERE settlement_batch_id = $1
		   AND account_id IN ('scheme_rounding_residue', 'card_scheme_clearing')
	`, result.BatchID).Scan(&residueDebit, &clearingCredit, &groups)
	if err != nil {
		t.Fatalf("query residue legs: %v", err)
	}
	if residueDebit != 12 || clearingCredit != 12 {
		t.Errorf("residue debit = %d, clearing credit = %d, want 12 and 12", residueDebit, clearingCredit)
	}
	if groups != 2 {
		t.Errorf("residue groups = %d, want 2 (one per line with a non-zero residue)", groups)
	}

	// Ledger ties to the file: per batch, sum(gross) - sum(amount_fils) == residue.
	var gross, exported int64
	if err := pool.QueryRow(ctx, `SELECT gross_fils FROM settlement_batches WHERE id = $1`, result.BatchID).Scan(&gross); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT SUM(amount_fils) FROM scheme_export_lines WHERE settlement_batch_id = $1`, result.BatchID).Scan(&exported); err != nil {
		t.Fatal(err)
	}
	if gross-exported != residueDebit {
		t.Errorf("gross %d - exported %d = %d, journaled residue %d", gross, exported, gross-exported, residueDebit)
	}
}
