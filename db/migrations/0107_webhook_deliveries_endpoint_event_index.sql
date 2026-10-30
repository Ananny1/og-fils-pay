-- BUG-080: admin batch replay now checks, per candidate, whether the same
-- outbox event already has a pending or succeeded delivery to the endpoint.
-- The only (outbox_event_id, endpoint_id) index is partial
-- (replay_of_delivery_id IS NULL), so it cannot answer that for replay rows;
-- without this index the check would walk every delivery of the endpoint.

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint_event
    ON webhook_deliveries (endpoint_id, outbox_event_id);
