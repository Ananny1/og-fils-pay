import type { ApiErrorBody } from "../types.js";

const API_BASE_URL =
  (import.meta.env.VITE_ADMIN_API_BASE_URL as string | undefined) ?? "http://localhost:3000";

/** apps/web's own dashboard origin — where a "view as merchant" grant is
 *  actually exercised. */
// FH: used to build the impersonation link
export const WEB_BASE_URL =
  (import.meta.env.VITE_WEB_BASE_URL as string | undefined) ?? "http://localhost:5173";

/** Mirrors apps/api's own uniform `{ error, message? }` body
 *  (lib/errors.ts / plugins/errorHandler.ts) — one error shape end to
 *  end, not reinvented client-side. Identical to apps/web's ApiError. */
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
 * `credentials: "include"` on every call: the admin plane is cookie-based
 * (`fp_admin_sid`), and the admin origin (5174) is not the API origin
 * (3000), so the session cookie only rides along when it is asked for
 * explicitly.
 *
 * `Content-Type: application/json` is sent only when there actually is a
 * body. Several admin routes take none at all (logout, balance rebuild,
 * start/end impersonation), and Fastify rejects a request that declares a
 * JSON content type while carrying an empty body (`FST_ERR_CTP_EMPTY_JSON_BODY`).
 */
/** Called on a `401` from any non-auth route: the session ended (expired,
 *  revoked, logged out elsewhere). AdminAuthContext registers it to drop back
 *  to the login screen instead of leaving a dead page. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

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
    if (res.status === 401 && !path.startsWith("/v1/admin/auth/")) {
      onUnauthorized?.();
    }
    throw new ApiError(res.status, (body as ApiErrorBody) ?? { error: "unknown_error" });
  }
  return body as T;
}

/** For the routes that answer `204 No Content` (logout, end
 *  impersonation) — a bare `request<void>` would work, but this makes
 *  "there is deliberately no body here" explicit at the call site. */
export async function requestNoContent(path: string, init?: RequestInit): Promise<void> {
  await request<unknown>(path, init);
}

/** Human-readable text for anything thrown by `request` — used by every
 *  page's error banner so a failure (including a server-side `403` from a
 *  role gate) is always *shown*, never silently swallowed. */
const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: "Email or password is wrong.",
  invalid_code: "That code is not right. Check it and try again.",
  otp_expired: "That code has expired. Go back and sign in again to get a new one.",
  resend_too_soon: "Please wait a moment before asking for another code.",
  no_pending_session: "Your sign-in timed out. Go back and enter your email and password again.",
  unauthenticated: "Your session ended. Please sign in again.",
};

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.statusCode === 403) {
      return `Not permitted (${err.code}) — your admin role does not allow this action.`;
    }
    const known = AUTH_MESSAGES[err.code];
    if (known) return known;
    if (err.statusCode === 429) return "Too many requests. Wait a minute and try again.";
    if (err.statusCode >= 500) return "FilsPay had a problem on its side. Try again in a moment.";
    return err.body.message ?? err.code;
  }
  // fetch() rejects with a TypeError when the network or the API is down.
  if (err instanceof TypeError) {
    return "Can't reach FilsPay right now. Check your connection and try again.";
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
