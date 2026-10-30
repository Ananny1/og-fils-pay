package settlement

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/filspay/settlement/internal/money"
)

// BUG-015: the scheme file amount must be exactly amount_fils / 1000 at two
// decimals (ADR-0002). 93.275 BD was written as 93.28 (rounded) while
// amount_fils kept 93270 (truncated), so the scheme was told 10 fils more
// than our own line.
func TestSchemeAmountBD_IsTruncatedAmountFils(t *testing.T) {
	cases := map[money.Fils]string{93275: "93.27", 4747: "4.74", 4749: "4.74", 1005: "1.00", 4740: "4.74", 9: "0.00"}
	for gross, want := range cases {
		if got := fmt.Sprint(SchemeAmountBD(gross)); got != want {
			t.Errorf("SchemeAmountBD(%d) = %q, want %q", gross, got, want)
		}
	}
}

func TestCloseBatch_SchemeLineAmountMatchesAmountFils(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 3, 25, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	for i, amount := range []money.Fils{93275, 94975, 4747, 4740} {
		insertCaptureEvent(t, pool, merchantID, mdrBps, amount, start.Add(time.Duration(i+1)*time.Hour))
	}
	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}

	rows, err := pool.Query(context.Background(), `
		SELECT line_sequence, amount_fils, amount::text, (amount * 1000)::bigint
		  FROM scheme_export_lines WHERE settlement_batch_id = $1 ORDER BY line_sequence
	`, result.BatchID)
	if err != nil {
		t.Fatalf("query lines: %v", err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var seq int32
		var amountFils, amountAsFils int64
		var amount string
		if err := rows.Scan(&seq, &amountFils, &amount, &amountAsFils); err != nil {
			t.Fatalf("scan: %v", err)
		}
		n++
		if amountAsFils != amountFils {
			t.Errorf("line %d: amount %s BD != amount_fils %d / 1000", seq, amount, amountFils)
		}
	}
	if n != 4 {
		t.Fatalf("got %d lines, want 4", n)
	}
}
