-- ENH-010: token budgets for the AI assistant. Each call row records the
-- tokens it actually used and the login session it came from, so the API can
-- cap tokens per session and per merchant per day (not just the call count).
ALTER TABLE assistant_usage
    ADD COLUMN session_key TEXT,
    ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_assistant_usage_session_time ON assistant_usage (session_key, created_at);
