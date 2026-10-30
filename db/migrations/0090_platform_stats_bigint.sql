-- BUG-022: platform_stats.total_processed_fils was INTEGER (int32, max
-- 2,147,483,647 fils = 2,147,483.647 BD), only ~7% above the 2,000,000,000
-- fils volume-tier threshold. PostgreSQL INTEGER is 32-bit on every build
-- (the 0049 comment claiming "64-bit on 64-bit builds" is false). Widen to
-- BIGINT like every other fils column (settlement_batches.*_fils).
ALTER TABLE platform_stats
    ALTER COLUMN total_processed_fils TYPE BIGINT;
