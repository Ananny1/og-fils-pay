-- An account locked after too many failed login steps (SEC-1). One row per
-- (plane, subject); `locked_until` is pushed forward when the lock is set
-- again. A successful login (OTP verified) deletes the row. Expired rows are
-- deleted by the throttle's periodic cleanup.

CREATE TABLE auth_lockouts (
    plane         TEXT NOT NULL CHECK (plane IN ('merchant', 'admin')),
    subject       TEXT NOT NULL,
    locked_until  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (plane, subject)
);

CREATE INDEX idx_auth_lockouts_locked_until ON auth_lockouts (locked_until);
