import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { logout as logoutRequest, me as fetchMe } from "../api/auth.js";
import { setUnauthorizedHandler } from "../api/client.js";
import {
  clearActiveImpersonation,
  endImpersonation,
  readActiveImpersonation,
  writeActiveImpersonation,
} from "../api/impersonation.js";
import type { ActiveImpersonation } from "../api/impersonation.js";
import type { AdminMe } from "../types.js";

export type AdminAuthStatus = "loading" | "authenticated" | "anonymous";

export interface AdminAuthValue {
  status: AdminAuthStatus;
  /** "expired" when the console was signed out by a 401 mid-session. */
  reason: "expired" | null;
  /** Non-null exactly when `status === "authenticated"`. */
  admin: AdminMe | null;
  /** Re-runs `GET /v1/admin/auth/me` — called after a successful OTP step. */
  refresh: () => Promise<void>;
  /** `POST /v1/admin/auth/logout`, then drops local state regardless. */
  signOut: () => Promise<void>;
  /** The locally-recorded active impersonation grant, if any. */
  impersonation: ActiveImpersonation | null;
  rememberImpersonation: (record: ActiveImpersonation) => void;
  /** `POST /v1/admin/impersonation/:grantId/end`, then drops the record. */
  exitImpersonation: () => Promise<void>;
}

const AdminAuthReactContext = createContext<AdminAuthValue | null>(null);

/**
 * Holds the answer to "who am I, per the server?" — loaded once on mount
 * from `GET /v1/admin/auth/me`. Nothing in this app treats a value
 * here as authority: every privileged route re-checks the session
 * server-side on every request, and this context exists so the UI can show
 * the right screen, not so it can decide what is allowed.
 */
// admin console memory leak — the impersonation interval is never cleared? — am
// FH: there's a clearInterval in the cleanup. still leaking though??
export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdminAuthStatus>("loading");
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [reason, setReason] = useState<"expired" | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const [impersonation, setImpersonation] = useState<ActiveImpersonation | null>(() =>
    readActiveImpersonation(),
  );

  const refresh = useCallback(async () => {
    try {
      const current = await fetchMe();
      setAdmin(current);
      setReason(null);
      setStatus("authenticated");
    } catch {
      // Any failure — 401, a revoked session, the API being down — lands the
      // operator on the login screen rather than a half-rendered console.
      setAdmin(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A 401 from any admin route mid-session: go back to the login screen
  // (RequireAdminAuth redirects) and say why, instead of a dead page.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (statusRef.current === "authenticated") setReason("expired");
      setAdmin(null);
      setStatus("anonymous");
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // An impersonation grant has a short, server-enforced lifetime
  // (config.impersonationTtlMinutes, default 15). Re-read the local record
  // on a timer so the banner disappears when the grant behind it expires
  // rather than lingering past it.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setImpersonation(readActiveImpersonation());
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const rememberImpersonation = useCallback((record: ActiveImpersonation) => {
    writeActiveImpersonation(record);
    setImpersonation(record);
  }, []);

  const exitImpersonation = useCallback(async () => {
    const current = readActiveImpersonation();
    if (!current) {
      setImpersonation(null);
      return;
    }
    try {
      await endImpersonation(current.grantId);
    } finally {
      // Whether or not the call succeeded, stop showing the grant as usable
      // here; if the server call failed, the grant still expires on its own.
      clearActiveImpersonation();
      setImpersonation(null);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      clearActiveImpersonation();
      setImpersonation(null);
      setAdmin(null);
      setStatus("anonymous");
    }
  }, []);

  const value = useMemo<AdminAuthValue>(
    () => ({
      status,
      reason,
      admin,
      refresh,
      signOut,
      impersonation,
      rememberImpersonation,
      exitImpersonation,
    }),
    [status, reason, admin, refresh, signOut, impersonation, rememberImpersonation, exitImpersonation],
  );

  return <AdminAuthReactContext.Provider value={value}>{children}</AdminAuthReactContext.Provider>;
}

export function useAdminAuth(): AdminAuthValue {
  const value = useContext(AdminAuthReactContext);
  if (!value) {
    throw new Error("useAdminAuth: must be used inside <AdminAuthProvider>");
  }
  return value;
}
