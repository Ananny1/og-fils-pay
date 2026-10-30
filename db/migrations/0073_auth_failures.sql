-- One row per failed login step (wrong password or wrong OTP code), on the
-- merchant or the admin login (SEC-1). Read by auth/throttle.ts to limit
-- failures per (client IP + account), per client IP, and per account. The
-- state lives here, not in memory, so every API instance sees the same
-- counts. `subject` is the normalised account key (merchant id + email, or
-- the admin email) and is recorded whether or not the account exists, so the
-- limits never tell an attacker which emails are real. Rows older than a day
-- are deleted by the throttle's own periodic cleanup.

CREATE TABLE auth_failures (
    id          BIGSERIAL PRIMARY KEY,
    plane       TEXT NOT NULL CHECK (plane IN ('merchant', 'admin')),
    ip_address  TEXT NOT NULL,
    subject     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The three windowed counts, and the cleanup sweep.
CREATE INDEX idx_auth_failures_ip ON auth_failures (plane, ip_address, created_at);
CREATE INDEX idx_auth_failures_subject ON auth_failures (plane, subject, created_at);
CREATE INDEX idx_auth_failures_created_at ON auth_failures (created_at);
