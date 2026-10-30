-- CAP-1 correctness check after a run (:run as in make-links.sql).
-- Every paid link must have exactly one captured transaction for exactly its
-- amount; no transaction may exist for a link that is not paid; no link may
-- stay 'reserved' for good.
\pset footer off
SELECT status, count(*) AS links FROM payment_links WHERE token LIKE 'plink_lt_' || :'run' || '_%' GROUP BY status ORDER BY status;

SELECT
  count(*) FILTER (WHERE pl.status = 'paid')                                        AS paid_links,
  count(*) FILTER (WHERE pl.status = 'paid' AND t.id IS NULL)                       AS paid_without_txn,
  count(*) FILTER (WHERE pl.status = 'paid' AND t.amount_fils <> pl.amount_fils)    AS paid_wrong_amount,
  count(*) FILTER (WHERE pl.status = 'paid' AND t.status NOT IN ('captured', 'settled')) AS paid_txn_not_captured
FROM payment_links pl
LEFT JOIN transactions t ON t.id = pl.transaction_id
WHERE pl.token LIKE 'plink_lt_' || :'run' || '_%';

-- Captured transactions created for this run's merchant+reference that no paid link points to
-- (a payment charged but not recorded on its link = "lost"), and links charged twice.
SELECT
  (SELECT count(*) FROM transactions t
    WHERE t.reference = 'loadtest-' || :'run' AND t.status IN ('captured', 'settled')) AS captured_txns,
  (SELECT count(*) FROM transactions t
    WHERE t.reference = 'loadtest-' || :'run' AND t.status IN ('captured', 'settled')
      AND NOT EXISTS (SELECT 1 FROM payment_links pl WHERE pl.transaction_id = t.id)) AS captured_not_on_a_link;
