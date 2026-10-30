-- BUG-028: merchants.lifetime_net_payout_monitoring_estimate was REAL
-- (float32, 24-bit mantissa), fed by a float32 in PayoutBatch. Above about
-- 16,777 BD it can no longer hold whole fils and the running total drifts
-- with every payout. Money is integer fils (ADR-0001), monitoring or not.
--
-- The drifted values cannot be repaired by a cast, so the total is
-- recomputed from what it is meant to mirror: the net payout of every paid
-- settlement batch for that merchant.
ALTER TABLE merchants
    ALTER COLUMN lifetime_net_payout_monitoring_estimate TYPE BIGINT
    USING round(lifetime_net_payout_monitoring_estimate)::bigint;

UPDATE merchants m
   SET lifetime_net_payout_monitoring_estimate = COALESCE((
         SELECT SUM(sb.net_payout_fils)
           FROM settlement_batches sb
          WHERE sb.merchant_id = m.id AND sb.status = 'paid'
       ), 0);
