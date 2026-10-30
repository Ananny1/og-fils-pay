package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// insertBatch inserts one settlement_batches row directly, so a test can
// place a batch in an exact (status, net_payout_fils) state without having
// to drive a whole RunDailyBatch pass to get there.
func insertBatch(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, batchDate time.Time, status string, netPayoutFils int64) uuid.UUID {
	t.Helper()
	var paidAt any
	if status == "paid" {
		paidAt = time.Now().UTC()
	}
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, paid_at)
		VALUES ($1, $2, $3, $4, 0, $4, $5)
		RETURNING id
	`, merchantID, batchDate, status, netPayoutFils, paidAt).Scan(&id)
	if err != nil {
		t.Fatalf("insertBatch: %v", err)
	}
	return id
}

func countPaidEvents(t *testing.T, pool *pgxpool.Pool, batchID uuid.UUID) int {
	t.Helper()
	var n int
	err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM outbox_events
		 WHERE event_type = 'settlement.paid' AND aggregate_id = $1
	`, batchID).Scan(&n)
	if err != nil {
		t.Fatalf("countPaidEvents: %v", err)
	}
	return n
}

func TestEnqueuePayoutNotificationsEnqueuesOnePerPaidBatch(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()

	merchantID := insertActiveMerchant(t, pool, 250)
	base := time.Date(2026, 3, 2, 0, 0, 0, 0, time.UTC)
	paidBatch := insertBatch(t, pool, merchantID, base, "paid", 471_300)

	if _, err := EnqueuePayoutNotifications(ctx, pool); err != nil {
		t.Fatalf("EnqueuePayoutNotifications: %v", err)
	}
	if got := countPaidEvents(t, pool, paidBatch); got != 1 {
		t.Fatalf("expected exactly 1 settlement.paid event for the paid batch, got %d", got)
	}

	// The payload the webhook dispatcher's delivery-creation join depends on:
	// merchantId must be present at the top level, or the event matches zero
	// endpoints.
	var merchantIDInPayload uuid.UUID
	var batchDate string
	var netPayoutFils int64
	err := pool.QueryRow(ctx, `
		SELECT (payload->>'merchantId')::uuid, payload->>'batchDate', (payload->>'netPayoutFils')::bigint
		  FROM outbox_events
		 WHERE event_type = 'settlement.paid' AND aggregate_id = $1
	`, paidBatch).Scan(&merchantIDInPayload, &batchDate, &netPayoutFils)
	if err != nil {
		t.Fatalf("read settlement.paid payload: %v", err)
	}
	if merchantIDInPayload != merchantID {
		t.Fatalf("payload merchantId = %s, want %s", merchantIDInPayload, merchantID)
	}
	if batchDate != "2026-03-02" {
		t.Fatalf("payload batchDate = %q, want %q", batchDate, "2026-03-02")
	}
	if netPayoutFils != 471_300 {
		t.Fatalf("payload netPayoutFils = %d, want 471300", netPayoutFils)
	}
}

// FH: sequential re-run only, concurrent run not covered. todo
func TestEnqueuePayoutNotificationsIsIdempotent(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()

	merchantID := insertActiveMerchant(t, pool, 250)
	paidBatch := insertBatch(t, pool, merchantID, time.Date(2026, 3, 3, 0, 0, 0, 0, time.UTC), "paid", 12_500)

	if _, err := EnqueuePayoutNotifications(ctx, pool); err != nil {
		t.Fatalf("first EnqueuePayoutNotifications: %v", err)
	}
	if _, err := EnqueuePayoutNotifications(ctx, pool); err != nil {
		t.Fatalf("second EnqueuePayoutNotifications: %v", err)
	}

	if got := countPaidEvents(t, pool, paidBatch); got != 1 {
		t.Fatalf("a second scan must be a no-op; expected 1 settlement.paid event, got %d", got)
	}
}

func TestEnqueuePayoutNotificationsSkipsIneligibleBatches(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()

	merchantID := insertActiveMerchant(t, pool, 250)
	zeroPayout := insertBatch(t, pool, merchantID, time.Date(2026, 3, 4, 0, 0, 0, 0, time.UTC), "paid", 0)
	notPaid := insertBatch(t, pool, merchantID, time.Date(2026, 3, 5, 0, 0, 0, 0, time.UTC), "closed", 90_000)

	if _, err := EnqueuePayoutNotifications(ctx, pool); err != nil {
		t.Fatalf("EnqueuePayoutNotifications: %v", err)
	}

	if got := countPaidEvents(t, pool, zeroPayout); got != 0 {
		t.Fatalf("a zero-payout batch must not be notified, got %d event(s)", got)
	}
	if got := countPaidEvents(t, pool, notPaid); got != 0 {
		t.Fatalf("a batch that has not reached 'paid' must not be notified, got %d event(s)", got)
	}
}

// BUG-008 (W6, incident 2026-08-21): the daemon tick and a manual `run-batch`
// (or two replicas) ran EnqueuePayoutNotifications at the same time. Both
// passed the NOT EXISTS check and both inserted a settlement.paid event. The
// comment above EnqueuePayoutNotifications quoted a unique index that did not
// exist.
//
// The race is made deterministic: a SHARE lock on outbox_events lets both
// runners' SELECT ... NOT EXISTS through but holds both INSERTs until both
// runners are waiting, which is exactly the incident's interleaving.
func TestEnqueuePayoutNotificationsConcurrentRunsEnqueueOnce(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()

	merchantID := insertActiveMerchant(t, pool, 250)
	paidBatch := insertBatch(t, pool, merchantID, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC), "paid", 10_000)

	lockTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin lock tx: %v", err)
	}
	defer lockTx.Rollback(ctx)
	if _, err := lockTx.Exec(ctx, `LOCK TABLE outbox_events IN SHARE MODE`); err != nil {
		t.Fatalf("lock outbox_events: %v", err)
	}

	const runners = 2
	errs := make(chan error, runners)
	for i := 0; i < runners; i++ {
		go func() {
			_, err := EnqueuePayoutNotifications(ctx, pool)
			errs <- err
		}()
	}

	// Wait until both runners have done their SELECT and are blocked on INSERT.
	deadline := time.Now().Add(10 * time.Second)
	for {
		var waiting int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM pg_locks
			 WHERE relation = 'outbox_events'::regclass AND NOT granted
		`).Scan(&waiting); err != nil {
			t.Fatalf("pg_locks: %v", err)
		}
		if waiting >= runners {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("runners never reached the INSERT (waiting=%d)", waiting)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err := lockTx.Commit(ctx); err != nil {
		t.Fatalf("release lock: %v", err)
	}

	for i := 0; i < runners; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent EnqueuePayoutNotifications: %v", err)
		}
	}

	if got := countPaidEvents(t, pool, paidBatch); got != 1 {
		t.Fatalf("expected exactly 1 settlement.paid event after %d concurrent runs, got %d", runners, got)
	}
}
