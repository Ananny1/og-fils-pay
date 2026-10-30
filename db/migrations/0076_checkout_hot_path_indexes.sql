-- BUG-038: every checkout capture full-scans two ever-growing tables.
--
-- 1. ledger_entries (entry_group_id): the deferred balance trigger from 0007
--    (check_ledger_group_balance) runs once per inserted ledger row at COMMIT
--    and sums `WHERE entry_group_id = $1`. With no index that is a full scan
--    of the whole ledger, 4 times per capture, while capture still holds its
--    transaction and payment-link row locks. Cost grows with every payment.
-- 2. holds (transaction_id): capture and void release the hold with
--    `UPDATE holds ... WHERE transaction_id = $1 AND status = 'active'`.
--    One hold per authorization, never deleted, no index: full scan.
-- 3. ledger_entries (transaction_id): the per-transaction reads in
--    discountAdjustment.ts and processRefund.ts (fee charged at capture).
--
-- Plain CREATE INDEX (the migrator runs each file in a transaction).

CREATE INDEX IF NOT EXISTS idx_ledger_entries_entry_group ON ledger_entries (entry_group_id);
CREATE INDEX IF NOT EXISTS idx_holds_transaction ON holds (transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_transaction ON ledger_entries (transaction_id);
