-- BUG-008 (analysis W6, incident 2026-08-21): duplicate payout notifications
-- and duplicate payout-rail disbursements.
--
-- 1. EnqueuePayoutNotifications (apps/settlement) did check-then-insert with
--    NOT EXISTS; its comment quoted a unique index on
--    outbox_events (event_type, aggregate_id) that never existed, so the
--    daemon and a manual run-batch both inserted a settlement.paid event.
-- 2. The dispatcher's settlement.paid pre-delivery effect wrote one
--    settlement_payout_disbursements row per delivery (per endpoint, per
--    replica); 0057 says "one row per paid batch" but nothing enforced it.
--
-- Existing duplicates are kept as evidence, not destroyed:
--   * later settlement.paid copies are re-typed 'settlement.paid.duplicate'
--     (webhook_deliveries still reference them; the dispatcher ignores the
--     type, so no new deliveries are made for them);
--   * later disbursement copies move to settlement_payout_disbursement_duplicates
--     so finance can recover the double payouts.

UPDATE outbox_events o
   SET event_type = 'settlement.paid.duplicate'
 WHERE o.event_type = 'settlement.paid'
   AND EXISTS (
     SELECT 1 FROM outbox_events e
      WHERE e.event_type = 'settlement.paid'
        AND e.aggregate_id = o.aggregate_id
        AND e.id < o.id
   );

CREATE UNIQUE INDEX uq_outbox_events_settlement_paid_batch
    ON outbox_events (event_type, aggregate_id)
 WHERE event_type = 'settlement.paid';

CREATE TABLE settlement_payout_disbursement_duplicates (
    id                      UUID PRIMARY KEY,
    settlement_batch_id     UUID NOT NULL REFERENCES settlement_batches (id),
    amount_fils             BIGINT NOT NULL,
    disbursement_reference  TEXT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL,
    moved_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

WITH moved AS (
  DELETE FROM settlement_payout_disbursements d
   WHERE EXISTS (
     SELECT 1 FROM settlement_payout_disbursements k
      WHERE k.settlement_batch_id = d.settlement_batch_id
        AND (k.created_at, k.id) < (d.created_at, d.id)
   )
  RETURNING d.id, d.settlement_batch_id, d.amount_fils, d.disbursement_reference, d.created_at
)
INSERT INTO settlement_payout_disbursement_duplicates
    (id, settlement_batch_id, amount_fils, disbursement_reference, created_at)
SELECT id, settlement_batch_id, amount_fils, disbursement_reference, created_at FROM moved;

CREATE UNIQUE INDEX uq_settlement_payout_disbursements_batch
    ON settlement_payout_disbursements (settlement_batch_id);
