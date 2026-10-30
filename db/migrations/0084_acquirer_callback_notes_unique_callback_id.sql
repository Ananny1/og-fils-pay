-- BUG-006 (analysis W2): acquirer callback redeliveries were applied twice.
-- README / HANDOVER say callbacks are recorded in `processed_events` first and
-- 0051's MK note says "FP-238 adds a unique index here — done". Neither
-- exists. callback_id is the acquirer's id for ONE callback (a second,
-- distinct callback for the same transaction carries a new callback_id), so
-- it is the natural dedupe key.
--
-- Existing redeliveries are duplicates of the first copy: keep the earliest
-- row per callback_id, drop the rest, then enforce uniqueness so
-- applyAcquirerCallback can INSERT ... ON CONFLICT (callback_id) DO NOTHING.

DELETE FROM acquirer_callback_notes a
 USING acquirer_callback_notes b
 WHERE a.callback_id = b.callback_id
   AND (a.created_at, a.id) > (b.created_at, b.id);

CREATE UNIQUE INDEX uq_acquirer_callback_notes_callback_id
    ON acquirer_callback_notes (callback_id);
