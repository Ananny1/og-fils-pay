package settlement

import (
	"context"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/filspay/settlement/internal/money"
)

var twoDecimalPlaces = regexp.MustCompile(`^\d+\.\d{2}$`)

// TestSchemeExportAmountHasTwoDecimals pins the acquirer-format promise
// scheme_export_lines.amount carries: every line handed to the clearing
// file is quoted in BD at exactly the two decimal places the scheme
// accepts — no third digit, no bare integer, no trailing-zero loss.
// am: 4747 -> "4.75" passes the regex. is 4.75 right for 4747 fils?? it rounds. whatever, scheme wants 2dp
func TestSchemeExportAmountHasTwoDecimals(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 3, 24, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	for i, amount := range []money.Fils{4747, 1005, 4740, 12344} {
		insertCaptureEvent(t, pool, merchantID, mdrBps, amount, start.Add(time.Duration(i+1)*time.Hour))
	}

	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}

	lines, err := LoadSchemeExportLines(context.Background(), pool, result.BatchID)
	if err != nil {
		t.Fatalf("LoadSchemeExportLines: %v", err)
	}
	if len(lines) != 4 {
		t.Fatalf("expected 4 exported lines, got %d", len(lines))
	}
	for _, line := range lines {
		if !twoDecimalPlaces.MatchString(line.Amount) {
			t.Errorf("line %d amount = %q, want exactly two decimal places", line.LineSequence, line.Amount)
		}
	}
}

// BUG-015: the file amount must be exactly amount_fils/1000 (ADR-0002), i.e.
// truncated like amount_fils, never rounded up. 4747 fils -> "4.74", not "4.75".
func TestSchemeExportAmountEqualsTruncatedFils(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 3, 25, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	amounts := []money.Fils{4747, 1005, 93275, 12344, 999_999}
	want := []string{"4.74", "1.00", "93.27", "12.34", "999.99"}
	for i, amount := range amounts {
		insertCaptureEvent(t, pool, merchantID, mdrBps, amount, start.Add(time.Duration(i+1)*time.Hour))
	}

	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	lines, err := LoadSchemeExportLines(context.Background(), pool, result.BatchID)
	if err != nil {
		t.Fatalf("LoadSchemeExportLines: %v", err)
	}
	got := make([]string, len(lines))
	for i, line := range lines {
		got[i] = line.Amount
	}
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("file amounts = %v, want %v (truncated, never rounded up)", got, want)
	}

	// The amount column and amount_fils must agree on every row.
	var mismatches int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM scheme_export_lines
		 WHERE settlement_batch_id = $1 AND amount <> amount_fils::numeric / 1000
	`, result.BatchID).Scan(&mismatches); err != nil {
		t.Fatalf("count mismatches: %v", err)
	}
	if mismatches != 0 {
		t.Fatalf("%d scheme_export_lines rows have amount != amount_fils/1000", mismatches)
	}
}
