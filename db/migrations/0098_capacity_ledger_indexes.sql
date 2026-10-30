-- CAP-3: indexes for the lookups every captured payment runs.
-- Without them each payment scans the whole table, and the deferred ledger
-- balance trigger (0007) does it once per inserted leg, so checkout gets
-- slower with every payment ever recorded.

-- check_ledger_group_balance(): WHERE entry_group_id = ...
CREATE INDEX IF NOT EXISTS idx_ledger_entries_entry_group
    ON ledger_entries (entry_group_id);

-- discountAdjustment.ts / processRefund.ts: WHERE transaction_id = ...
CREATE INDEX IF NOT EXISTS idx_ledger_entries_transaction
    ON ledger_entries (transaction_id)
    WHERE transaction_id IS NOT NULL;

-- capture.ts / void.ts hold release: WHERE transaction_id = ... AND status = 'active'
CREATE INDEX IF NOT EXISTS idx_holds_transaction
    ON holds (transaction_id)
    WHERE transaction_id IS NOT NULL;
