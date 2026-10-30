-- BUG-105: an imported adjustment row is journaled to merchant_payable
-- (apps/api/src/admin/adjustmentImport.ts via ledgerAdjustments.ts) but no
-- batch ever paid a positive one out or deducted a negative one. CloseBatch
-- now claims each unbatched row into the next batch, the same way it claims
-- credits (0100) and refunds (0042). This column records which batch
-- settled it, so a row is settled exactly once.
ALTER TABLE adjustment_import_rows
    ADD COLUMN settlement_batch_id UUID REFERENCES settlement_batches (id);

-- CloseBatch: WHERE merchant_id = $1 AND settlement_batch_id IS NULL
--             AND parsed_amount_fils <> 0 AND created_at < $2
CREATE INDEX idx_adjustment_import_rows_unbatched
    ON adjustment_import_rows (merchant_id, created_at)
    WHERE settlement_batch_id IS NULL AND parsed_amount_fils <> 0;
