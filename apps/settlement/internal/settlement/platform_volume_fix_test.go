package settlement

import (
	"context"
	"testing"
)

// BUG-022: the platform volume counter was int32 in Go and INTEGER in
// Postgres. The tier threshold (2,000,000,000 fils) sits 7% below int32 max
// (2,147,483,647), so the counter wraps negative soon after the tier is
// reached and the bonus silently switches off again.
func TestRecordPlatformProcessedVolume_PastInt32Max_Fix(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()

	// Everything in one rolled-back transaction: other packages' tests close
	// batches concurrently and read this shared counter.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `UPDATE platform_stats SET total_processed_fils = 2100000000 WHERE id = 1`); err != nil {
		t.Fatalf("seed counter: %v", err)
	}
	current, err := ReadAndLockPlatformProcessedFils(ctx, tx)
	if err != nil {
		t.Fatalf("ReadAndLockPlatformProcessedFils: %v", err)
	}
	if err := RecordPlatformProcessedVolume(ctx, tx, current, 100_000_000); err != nil {
		t.Fatalf("RecordPlatformProcessedVolume: %v", err)
	}

	var got int64
	if err := tx.QueryRow(ctx, `SELECT total_processed_fils FROM platform_stats WHERE id = 1`).Scan(&got); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if got != 2_200_000_000 {
		t.Fatalf("total_processed_fils = %d, want 2200000000", got)
	}
	again, err := ReadAndLockPlatformProcessedFils(ctx, tx)
	if err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if bonus := VolumeTierMdrBonusBps(again); bonus != 15 {
		t.Fatalf("tier bonus at 2.2bn fils = %d, want 15", bonus)
	}
}
