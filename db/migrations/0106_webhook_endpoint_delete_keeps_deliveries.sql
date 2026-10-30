-- BUG-078: deleting a webhook endpoint that had any delivery returned 500.
-- 0022 and 0068 declared endpoint_id NOT NULL REFERENCES webhook_endpoints
-- with no ON DELETE action, so the DELETE in webhooks/cancel.ts failed on the
-- FK. Comments in cancel.ts / routes/webhooks.ts claimed "ON DELETE SET NULL
-- (0029)" and "ON DELETE CASCADE (0047)"; neither migration touches these
-- tables.
--
-- The delivery log and archives are an audit trail ("deliveries are never
-- deleted", 0068), so they are kept and lose only the link to the removed
-- endpoint: endpoint_id becomes nullable, ON DELETE SET NULL.

ALTER TABLE webhook_deliveries ALTER COLUMN endpoint_id DROP NOT NULL;
ALTER TABLE webhook_deliveries DROP CONSTRAINT webhook_deliveries_endpoint_id_fkey;
ALTER TABLE webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_endpoint_id_fkey
    FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints (id) ON DELETE SET NULL;

ALTER TABLE webhook_delivery_archives ALTER COLUMN endpoint_id DROP NOT NULL;
ALTER TABLE webhook_delivery_archives DROP CONSTRAINT webhook_delivery_archives_endpoint_id_fkey;
ALTER TABLE webhook_delivery_archives
    ADD CONSTRAINT webhook_delivery_archives_endpoint_id_fkey
    FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints (id) ON DELETE SET NULL;
