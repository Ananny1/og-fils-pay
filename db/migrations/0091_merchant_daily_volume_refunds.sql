-- FP-300.5: refunds in the daily volume rollup. apps/reporting applies each
-- refund.succeeded outbox event here (bucketed by Asia/Bahrain date, like
-- captures), summing the event's own amountFils delta. Columns default to 0
-- so existing rows and readers are unchanged.

ALTER TABLE merchant_daily_volume
    ADD COLUMN refund_count      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN refund_gross_fils BIGINT  NOT NULL DEFAULT 0;
