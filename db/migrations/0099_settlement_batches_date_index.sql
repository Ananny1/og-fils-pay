-- 0099: index settlement_batches by batch_date alone (FP-301).
-- The admin "Payout days" panel groups the last 7 business days across all
-- merchants; the existing unique (merchant_id, batch_date) index cannot serve
-- a date-only range, so without this every load would scan the whole table.
CREATE INDEX IF NOT EXISTS idx_settlement_batches_batch_date ON settlement_batches (batch_date);
