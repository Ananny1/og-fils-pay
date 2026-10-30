import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, verifyOtp } from "../../api/auth.js";
import { ApiError, describeError } from "../../api/client.js";
import { useAdminAuth } from "../../auth/AdminAuthContext.js";
import type { AdminLoginResponse } from "../../types.js";
import { ThemeToggle } from "../../components/ThemeToggle.js";
import { time } from "../../format.js";

type Step =
  | { kind: "credentials" }
  | { kind: "otp"; challenge: AdminLoginResponse };

/**
 * Two-step admin login: email + password creates a *pending* session
 * and issues an OTP challenge; the OTP step is what actually authenticates
 * it. Neither step is told which half of a bad credential pair was wrong —
 * the API answers a single generic `invalid_credentials`, and this screen
 * repeats it verbatim rather than guessing at something more specific.
 */
export function LoginPage() {
  const { status, reason, refresh } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo =
    (location.state as { from?: string } | null)?.from ?? "/merchants";

  if (status === "authenticated") {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleCredentials(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const challenge = await login({ email, password });
      setStep({ kind: "otp", challenge });
      setPassword("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // YA: admin verify re-issues the cookie with the full TTL
  async function handleOtp(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await verifyOtp({ code });
      // The session cookie is now authenticated server-side; re-read `me`
      // so the rest of the console renders from the server's answer, not
      // from the verify response we happen to be holding.
      await refresh();
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(describeError(err));
      // Locked out of this code, or the pending sign-in is gone: the code
      // step can no longer succeed, so go back to email + password.
      if (
        err instanceof ApiError &&
        ((err.statusCode === 429 && err.code === "too_many_attempts") ||
          err.code === "otp_expired" ||
          err.code === "no_pending_session")
      ) {
        if (err.statusCode === 429) {
          setError("Too many wrong codes. Sign in again to get a new code.");
        }
        setStep({ kind: "credentials" });
        setCode("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-centered">
      <ThemeToggle />
      <h1>FilsPay Admin</h1>
      <p className="admin-muted">
        {step.kind === "otp" ? "Check your inbox" : "Internal operations console."}
      </p>

      {reason === "expired" && !error && step.kind === "credentials" ? (
        <p className="admin-notice" role="status">Your session ended. Please sign in again.</p>
      ) : null}
      {error ? <p className="admin-error">{error}</p> : null}

      {step.kind === "credentials" ? (
        <form onSubmit={(e) => void handleCredentials(e)} className="admin-form">
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Continue"}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void handleOtp(e)} className="admin-form">
          <p>
            A one-time code was issued for <strong>{email}</strong>. It expires at{" "}
            {time(step.challenge.otpExpiresAt)} (Bahrain time).
          </p>
          {step.challenge.devOtpCode ? (
            <p className="admin-muted">
              Development code: <code>{step.challenge.devOtpCode}</code>{" "}
              <button
                type="button"
                className="admin-btn-quiet"
                onClick={() => setCode(step.challenge.devOtpCode ?? "")}
              >
                Use this code
              </button>
            </p>
          ) : null}
          <label>
            One-time code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? "Verifying..." : "Verify"}
          </button>
          <button
            type="button"
            className="admin-btn-quiet"
            onClick={() => {
              setStep({ kind: "credentials" });
              setCode("");
              setError(null);
            }}
          >
            Back
          </button>
        </form>
      )}
    </main>
  );
}
