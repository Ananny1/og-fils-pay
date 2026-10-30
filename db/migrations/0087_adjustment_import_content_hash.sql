-- BUG-029: the same adjustment CSV could be applied twice (double-click,
-- re-upload) and post the money twice. content_hash is a SHA-256 of the
-- parsed rows (merchant, amount in fils, reason); a unique index makes the
-- second apply fail, including two concurrent submits. Older imports keep
-- NULL, which the partial index ignores.
ALTER TABLE adjustment_imports ADD COLUMN content_hash TEXT;

CREATE UNIQUE INDEX uq_adjustment_imports_content_hash
    ON adjustment_imports (content_hash)
    WHERE content_hash IS NOT NULL;
