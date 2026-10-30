-- BUG-022: platform_stats.total_processed_fils was INTEGER (max
-- 2,147,483,647 fils = 2.1M BD) while the volume-tier threshold it is
-- compared against is 2,000,000,000 fils. The counter would wrap (Go int32)
-- or fail to write (Postgres INTEGER) about 7% after the tier is reached.
-- PostgreSQL INTEGER is always 32-bit, whatever the build (0049's comment is
-- wrong). Widening is lossless; existing values are kept.
ALTER TABLE platform_stats
    ALTER COLUMN total_processed_fils TYPE BIGINT;
