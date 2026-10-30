-- SEC-2: idle session timeout. A logged-in session now also dies after a
-- stretch with no requests (SESSION_IDLE_MINUTES / ADMIN_SESSION_IDLE_MINUTES),
-- not only at its fixed expires_at. lookupSession / lookupAdminSession compare
-- last_seen_at against the idle window and move it forward on use, but at most
-- once a minute per session, so a busy dashboard is not one UPDATE per request.
-- Lookups stay on token_hash (UNIQUE) and the touch is by id (PK): no new
-- index is needed.

ALTER TABLE sessions ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE admin_sessions ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- lookupSession reads live_sessions (0058); a view only takes new columns at the end.
CREATE OR REPLACE VIEW live_sessions AS
SELECT id,
       merchant_user_id,
       token_hash,
       authenticated,
       created_at,
       expires_at,
       last_seen_at
  FROM sessions
 WHERE revoked_at IS NULL
   AND expires_at > now();
