-- BUG-006: acquirer callbacks were never deduplicated.
-- 0051's trailing comment claims redelivery dedupe is done "by
-- processed_events on our side" and that "FP-238 adds a unique index here".
-- Neither exists: there is no processed_events table and no unique index,
-- so every redelivery of the same callback_id (the acquirer retries on any
-- timeout, and our own withCallbackRetry re-runs the insert) appended
-- another note to the transaction timeline.
--
-- callback_id is the acquirer's identifier for ONE callback; a transaction
-- can get several distinct callbacks, each with its own id, so uniqueness
-- on callback_id alone is the right key.
--
-- Existing duplicates are collapsed first (keep the earliest row for each
-- callback_id — the first delivery is the one we acted on), otherwise the
-- unique index cannot be built.

DELETE FROM acquirer_callback_notes n
 USING acquirer_callback_notes keep
 WHERE n.callback_id = keep.callback_id
   AND (keep.created_at, keep.id) < (n.created_at, n.id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_acquirer_callback_notes_callback_id
    ON acquirer_callback_notes (callback_id);
