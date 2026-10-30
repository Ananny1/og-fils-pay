-- BUG-029 review: 0087's unique content_hash was permanent and global, so an
-- identical, legitimate correction next month was refused forever. The guard
-- is meant to stop a double-click or re-upload, so scope it to one
-- settlement day (midnight Asia/Bahrain): the same rows twice on the same
-- Bahrain day are refused; on a later day they are accepted.
-- content_day defaults to today's Bahrain date, so the API does not pass it.
ALTER TABLE adjustment_imports
    ADD COLUMN content_day DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Bahrain')::date);

UPDATE adjustment_imports
   SET content_day = (created_at AT TIME ZONE 'Asia/Bahrain')::date;

DROP INDEX uq_adjustment_imports_content_hash;

CREATE UNIQUE INDEX uq_adjustment_imports_content_hash_day
    ON adjustment_imports (content_hash, content_day)
    WHERE content_hash IS NOT NULL;
