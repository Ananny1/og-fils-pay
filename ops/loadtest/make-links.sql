-- CAP-1 load test data: :count unpaid payment links of 1.500 BD (1500 fils)
-- named plink_lt_<run>_0 .. plink_lt_<run>_<count-1>, owned by the first
-- approved seeded merchant. Run against the TARGET database only:
--   docker exec -i <postgres container> psql -U filspay -d filspay \
--     -v run=a -v count=40000 < ops/loadtest/make-links.sql
INSERT INTO payment_links (merchant_id, token, amount_fils, reference, expires_at, created_by_type, created_by_id)
SELECT m.id, 'plink_lt_' || :'run' || '_' || g, 1500, 'loadtest-' || :'run', now() + interval '1 day',
       'merchant_api_key', k.id
  FROM (SELECT id FROM merchants WHERE onboarding_status = 'approved' ORDER BY id LIMIT 1) m
  JOIN LATERAL (SELECT id FROM api_keys WHERE merchant_id = m.id LIMIT 1) k ON true
 CROSS JOIN generate_series(0, :count - 1) g;
