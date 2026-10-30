-- BUG-008 follow-up: 0085 re-typed duplicate settlement.paid outbox events
-- to 'settlement.paid.duplicate', so no NEW deliveries are made for them.
-- But webhook_deliveries rows already created for those events keep their
-- own event_type ('settlement.paid') and stay 'pending', so the dispatcher's
-- retry step still sends the duplicate payout notice to the merchant.
--
-- Mark those pending rows terminal. 'failed' is an existing terminal status
-- (0022 CHECK) that the dispatcher never sets itself, so these rows stay
-- easy to tell apart from real delivery failures ('exhausted'). Rows are
-- kept (not deleted) as evidence; already-sent rows are left as they are.

UPDATE webhook_deliveries d
   SET status = 'failed'
  FROM outbox_events o
 WHERE o.id = d.outbox_event_id
   AND o.event_type = 'settlement.paid.duplicate'
   AND d.status = 'pending';
