-- ENH-009: one row per AI assistant call, so per-merchant minute/day budgets
-- hold across API instances. Rows older than a day are deleted as calls come in.
CREATE TABLE assistant_usage (
    id          BIGSERIAL PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assistant_usage_merchant_time ON assistant_usage (merchant_id, created_at);
