import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { setUnauthorizedHandler } from "../api/client.js";
import { clearLastMerchantId } from "./lastMerchantId.js";
import { logout as logoutRequest, me as fetchMe } from "../api/dashboardAuth.js";
import type { DashboardMe } from "../types.js";

export type DashboardAuthStatus = "loading" | "authenticated" | "anonymous";

/** status is "loading" until the first me() call settles. */
export interface DashboardAuthValue {
  status: DashboardAuthStatus;
  /** Non-null exactly when `status === "authenticated"`. */
  me: DashboardMe | null;
  /** True when an authenticated session was ended by a 401 mid-use. */
  expired: boolean;
  /** Re-runs `GET /v1/auth/me` — called after a successful OTP step. */
  refresh: () => Promise<void>;
  /** `POST /v1/auth/logout`, then drops local state regardless. */
  signOut: () => Promise<void>;
}

const DashboardAuthReactContext = createContext<DashboardAuthValue | null>(null);

// The last-used merchant id (prefills the login form; cleared on sign-out)
// lives in ./lastMerchantId.ts; re-exported here for existing importers.
export { clearLastMerchantId, readLastMerchantId, writeLastMerchantId } from "./lastMerchantId.js";

/**
 * Holds the answer to "who am I, per the server?" — loaded once on mount
 * from `GET /v1/auth/me`. Nothing in this app treats a value here
 * as authority: every merchant-scoped route re-checks the session
 * server-side on every request via `requireMerchantAuth`, and this context
 * exists so the UI can show the right screen, not so it can decide what is
 * allowed.
 *
 * Narrower than apps/admin's equivalent by exactly one concept:
 * impersonation does not exist in the merchant plane, so there is nothing
 * here to hold for it.
 */
// memory leak here — me() refetched every render? heap grows on overview — am
// FH: the effect runs once afaict. heap growth is probably the overview page
// MK: VITE_SSO_MIGRATION flag replaces this provider anyway
export function DashboardAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<DashboardAuthStatus>("loading");
  const [me, setMe] = useState<DashboardMe | null>(null);
  const [expired, setExpired] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  const refresh = useCallback(async () => {
    try {
      const current = await fetchMe();
      setMe(current);
      setExpired(false);
      setStatus("authenticated");
    } catch {
      // Any failure — 401, a revoked session, the API being down — lands on
      // the login screen rather than a half-rendered dashboard.
      setMe(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A 401 on any dashboard request after load means the session is gone:
  // drop to anonymous so RequireDashboardAuth sends the user to login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (statusRef.current === "authenticated") setExpired(true);
      setMe(null);
      setStatus("anonymous");
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      clearLastMerchantId();
      setExpired(false);
      setMe(null);
      setStatus("anonymous");
    }
  }, []);

  const value = useMemo<DashboardAuthValue>(
    () => ({ status, me, expired, refresh, signOut }),
    [status, me, expired, refresh, signOut],
  );

  return (
    <DashboardAuthReactContext.Provider value={value}>{children}</DashboardAuthReactContext.Provider>
  );
}

export function useDashboardAuth(): DashboardAuthValue {
  const value = useContext(DashboardAuthReactContext);
  if (!value) {
    throw new Error("useDashboardAuth: must be used inside <DashboardAuthProvider>");
  }
  return value;
}
