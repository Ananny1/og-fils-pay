-- BUG-096: the reporting consumer's watermark was an outbox id, but ids are
-- handed out when a row is INSERTed, not when its transaction COMMITs. A slow
-- transaction holding id N could commit after the consumer had already moved
-- past N+1, so event N was skipped forever.
--
-- Fix: stamp each outbox row with the id of the transaction that wrote it.
-- Every row whose txid is below the oldest still-running transaction
-- (pg_snapshot_xmin) is final, and no later row can sort before it, so the
-- consumer can safely walk rows in (txid, id) order.
--
-- Existing rows get txid '0' (no table rewrite); the cursor's txid also
-- starts at '0', so the current (0, last_processed_id) watermark keeps
-- pointing at exactly the same place in the old rows. New rows get the
-- writer's real transaction id from the column default.
ALTER TABLE outbox_events ADD COLUMN txid xid8 NOT NULL DEFAULT '0';
ALTER TABLE outbox_events ALTER COLUMN txid SET DEFAULT pg_current_xact_id();

CREATE INDEX idx_outbox_events_txid_id ON outbox_events (txid, id);

ALTER TABLE reporting_outbox_cursor ADD COLUMN last_processed_txid xid8 NOT NULL DEFAULT '0';
