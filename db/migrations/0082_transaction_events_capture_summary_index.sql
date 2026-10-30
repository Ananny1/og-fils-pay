-- BUG-024 (performance half): GET /v1/settlement/summary for a large
-- multi-capture merchant (Delta Wholesale) seq-scanned all of
-- transaction_events (docs/perf/2026-07-settlement-summary-slow.md: 3-6 s,
-- "resolved" only by raising shared_buffers). The query joins the
-- merchant's transactions to their capture events in a time window, so a
-- partial index on capture events keyed by transaction then time, carrying
-- amount_fils, lets Postgres do an index-only nested loop instead.
-- The same shape also serves the reconciliation pending query and
-- CloseBatch's eligible-event scan per transaction.
--
-- Plain CREATE INDEX because db/migrate.ts runs each file in a transaction;
-- on a large production table build it first with CREATE INDEX
-- CONCURRENTLY under this name, and this statement becomes a no-op.

CREATE INDEX IF NOT EXISTS idx_transaction_events_capture_txn_occurred
    ON transaction_events (transaction_id, occurred_at)
    INCLUDE (amount_fils)
    WHERE event_type IN ('captured', 'partially_captured');
