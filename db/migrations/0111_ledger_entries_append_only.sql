-- BUG-094: 0007 says the balance trigger makes ledger_entries immutable
-- ("an edited or removed leg unbalances its group and the commit is
-- rejected"). It does not: the trigger only re-checks NEW.entry_group_id, so
-- an UPDATE can move a leg out of a group and leave that group unbalanced,
-- and any edit or delete that keeps a group balanced (both legs changed, or
-- the whole group deleted) commits silently. No code path updates or deletes
-- ledger rows (corrections are new reversing groups), so refuse both outright.
-- TRUNCATE (seed reset) does not fire row triggers and is unaffected.

CREATE FUNCTION reject_ledger_entry_change() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ledger_entries is append-only: % of entry % refused; post a reversing entry group instead',
        TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_append_only
    BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION reject_ledger_entry_change();
