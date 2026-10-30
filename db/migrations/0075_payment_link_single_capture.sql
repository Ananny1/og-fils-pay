-- BUG-005 (incident 2026-05-14, FP-202): one payment link must never be
-- captured more than once.
--
-- The postmortem says FP-202 added "a unique constraint so a payment link can
-- have at most one successful capture". It never existed: transactions had no
-- column linking them to a payment link, so nothing in the schema could stop a
-- second captured transaction. The link reservation also had no owner, so a
-- payer whose reservation had timed out could not tell that somebody else now
-- held it.
--
-- 1. payment_links.reservation_id: a fresh UUID written by every claim. The
--    capture step checks it (under a row lock) before calling the acquirer,
--    so only the current holder of the reservation can move money.
-- 2. transactions.payment_link_id: which link a checkout transaction pays.
-- 3. A partial unique index: at most one transaction with money captured per
--    link. This is the database-level guarantee; the application check above
--    keeps us from ever reaching it after the acquirer has captured.

ALTER TABLE payment_links ADD COLUMN reservation_id UUID;

ALTER TABLE transactions ADD COLUMN payment_link_id UUID REFERENCES payment_links (id);

CREATE UNIQUE INDEX uq_transactions_payment_link_captured
    ON transactions (payment_link_id)
    WHERE payment_link_id IS NOT NULL AND captured_fils > 0;
