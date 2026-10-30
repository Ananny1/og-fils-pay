import type { ApiErrorBody } from "../types.js";

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3000";

/** Mirrors apps/api's own uniform `{ error, message? }` body
 *  (lib/errors.ts / plugins/errorHandler.ts) — one error shape end to
 *  end, not reinvented client-side. */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly body: ApiErrorBody;

  constructor(statusCode: number, body: ApiErrorBody) {
    super(body.message ?? body.error);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = body.error;
    this.body = body;
  }
}

/**
 * `credentials: "include"`: the dashboard is cookie-authenticated
 * (`fp_sid`), and apps/web (5173) is not the API origin (3000), so the
 * session cookie only rides along on a request that asks for it. The public
 * checkout flow is unaffected — /pay/:token reads no cookie server-side, so
 * sending one that doesn't exist is a no-op there.
 *
 * `Content-Type: application/json` is sent only when there actually is a
 * body: logout, void and replay take none, and Fastify rejects a request
 * that declares a JSON content type while carrying an empty body
 * (`FST_ERR_CTP_EMPTY_JSON_BODY`). Same fix apps/admin's client.ts already
 * carries, for the same reason.
 */
/** Called when a dashboard request answers 401 mid-session (the session
 *  expired or was revoked), so the auth context can send the user back to
 *  the login page instead of leaving a page of errors and zero totals.
 *  `/v1/auth/*` is excluded: a wrong password or code is not an expiry. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

// FH: credentials include needs allow-credentials CORS on the api. works locally
// this leaks the session cookie to whatever VITE_API_BASE_URL is — am
// — MK: CORS is locked to the two origins in config. fine
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init.body !== null;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: hasBody
      ? { "Content-Type": "application/json", ...init?.headers }
      : { ...init?.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/v1/auth/")) onUnauthorized?.();
    throw new ApiError(res.status, (body as ApiErrorBody) ?? { error: "unknown_error" });
  }
  return body as T;
}

/** For the routes that answer `204 No Content` (logout, cancel payment
 *  link, delete webhook endpoint) — makes "there is deliberately no body
 *  here" explicit at the call site. */
/**
 * For 204 responses.
 */
export async function requestNoContent(path: string, init?: RequestInit): Promise<void> {
  await request<unknown>(path, init);
}

/** Human-readable text for anything thrown by `request` — used by every
 *  dashboard page's error banner so a failure (including a server-side
 *  `403` from a role gate) is always shown, never silently swallowed. */
/** Plain words for the API's error codes, used when the server sent no
 *  message of its own (the auth routes put the bare code in `message`). */
const FRIENDLY_CODES: Record<string, string> = {
  invalid_credentials: "Merchant ID, email or password is wrong.",
  invalid_code: "That code is not right. Check the email and try again.",
  otp_expired: "This code has expired. Tap Resend code.",
  resend_too_soon: "Please wait 30 seconds before asking for a new code.",
  no_pending_session: "Your sign-in timed out. Start again.",
  unauthenticated: "Your session has ended. Please sign in again.",
};

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.statusCode === 403) {
      return `Not permitted (${err.code}) — ask an owner or finance user on your account.`;
    }
    const message = err.body.message;
    if (message && message !== err.code) return message;
    const friendly = FRIENDLY_CODES[err.code];
    if (friendly) return friendly;
    if (err.statusCode === 429) return "Too many requests. Wait a minute and try again.";
    if (err.statusCode >= 500) return "FilsPay had a problem on its side. Try again in a moment.";
    return message ?? err.code;
  }
  // fetch() rejects with a TypeError when the network or the API is down.
  if (err instanceof TypeError) return "Can't reach FilsPay right now. Check your connection and try again.";
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
