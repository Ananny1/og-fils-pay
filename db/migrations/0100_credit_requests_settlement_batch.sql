-- BUG-070: a posted manual credit is journaled to merchant_payable
-- (apps/api/src/admin/credits.ts) but no batch ever paid it out — CloseBatch
-- only summed capture events and refunds. CloseBatch now claims each posted,
-- unbatched credit into the next batch's payout, the same way it claims
-- refunds (0042). This column records which batch paid it, so a credit is
-- paid exactly once.
ALTER TABLE credit_requests
    ADD COLUMN settlement_batch_id UUID REFERENCES settlement_batches (id);

-- CloseBatch: WHERE merchant_id = $1 AND status = 'posted'
--             AND settlement_batch_id IS NULL AND posted_at < $2
CREATE INDEX idx_credit_requests_unbatched
    ON credit_requests (merchant_id, posted_at)
    WHERE status = 'posted' AND settlement_batch_id IS NULL;
