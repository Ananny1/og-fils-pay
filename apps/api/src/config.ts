/**
 * App-wide configuration, loaded once from environment variables at boot.
 * `loadConfig` throws synchronously — crashing boot rather than serving
 * traffic in a half-configured state — if `DATABASE_URL` is missing, or if
 * `SETTLEMENT_INTERNAL_TOKEN` is missing while `nodeEnv === 'production'`.
 *
 * Later sub-phases add their own fields to this same interface/loader
 * rather than introducing a second config system.
 */
export interface Config {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;

  pgPoolMax: number;
  pgPoolMin: number;
  pgPoolIdleTimeoutMs: number;
  pgPoolConnectionTimeoutMs: number;
  /** Server-side `statement_timeout` for every pooled connection: a
   *  runaway query is cancelled by Postgres instead of pinning a connection
   *  (and a slot of the small pool) forever. 0 disables. */
  pgStatementTimeoutMs: number;
  /** Server-side `idle_in_transaction_session_timeout`: a connection left
   *  in an open transaction (crashed handler, killed process) is closed by
   *  Postgres so its row locks are released. 0 disables. */
  pgIdleInTransactionTimeoutMs: number;
  /** Hard cap on graceful shutdown (index.ts): after SIGTERM the process
   *  exits even if something is stuck, before Docker's SIGKILL. */
  shutdownTimeoutMs: number;
  /** Dashboard assistant (routes/assistant.ts). An empty key disables it
   *  (the route answers 503 assistant_not_configured). */
  anthropicApiKey: string;
  assistantModel: string;
  /** Hard cap on Claude's output per reply. */
  assistantMaxTokens: number;
  assistantEffort: "low" | "medium" | "high";
  /** Max data lookups Claude may chain for one question. */
  assistantMaxToolRounds: number;
  /** How many past chat turns are sent back to Claude. */
  assistantMaxHistory: number;
  /** Longest user message accepted, in characters. */
  assistantMaxMessageChars: number;
  /** Paid AI calls allowed per merchant per minute / per day (ENH-009). */
  assistantPerMinute: number;
  assistantPerDay: number;

  /** Load shedding (CAP-2, plugins/loadShedding.ts): requests allowed in
   *  flight at once before the api answers 503 + Retry-After. 0 = off. */
  apiMaxInFlight: number;
  /** Retry-After (seconds) on a shed request or a full DB pool. */
  apiRetryAfterSeconds: number;

  /** Max JSON body for every route (SEC-3). Routes that need more (the
   *  adjustment CSV import) set their own `bodyLimit`; KYC uploads are
   *  multipart and capped by `kycMaxFileSizeBytes` instead. */
  httpBodyLimitBytes: number;
  /** `bodyLimit` of POST /v1/admin/adjustment-imports (CSV pasted as JSON). */
  adjustmentImportBodyLimitBytes: number;
  /** Idle socket timeout: a connection that sends nothing for this long is
   *  closed (slow-loris). Must stay above the slowest handler, which is the
   *  30s internal settlement call. */
  httpConnectionTimeoutMs: number;
  /** Time a client gets to send all its headers. */
  httpHeadersTimeoutMs: number;
  /** Time a client gets to send the whole request, body included (an 8 MB
   *  KYC upload on a slow phone link fits in it). */
  httpRequestTimeoutMs: number;
  httpKeepAliveTimeoutMs: number;

  sessionTtlHours: number;
  /** SEC-2: a session with no request for this long is dead, even before
   *  its fixed `sessionTtlHours` expiry. */
  sessionIdleMinutes: number;
  pendingSessionTtlMinutes: number;
  otpTtlMinutes: number;
  otpCodeLength: number;
  otpMaxAttempts: number;
  otpDevExpose: boolean;

  /** OTP delivery by email (ENH-001). Empty `smtpHost` = no email is sent;
   *  the notifiers only log, as before. Locally this is Mailpit; hosted, an
   *  SMTP server such as Gmail with an app password. */
  smtpHost: string;
  smtpPort: number;
  /** true = TLS from the first byte (port 465); false = plain/STARTTLS (587, 1025). */
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  mailFrom: string;

  argon2MemoryKib: number;
  argon2TimeCost: number;
  argon2Parallelism: number;

  kycUploadDir: string;
  kycMaxFileSizeBytes: number;
  /** Base64 32-byte AES-256-GCM key for KYC files at rest (SEC-4).
   *  KYC_ENCRYPTION_KEY, same validation as the webhook key; falls back
   *  to WEBHOOK_SECRET_ENCRYPTION_KEY when unset so an existing box keeps
   *  booting. Set a dedicated one in production. */
  kycEncryptionKey: string;

  acquirerLatencyMinMs: number;
  acquirerLatencyMaxMs: number;
  acquirerFailureRate: number;
  acquirerRngSeed: number | null;

  cookieName: string;
  cookieSecure: boolean;

  /** Cookie carrying an `admin_sessions` token. A completely separate name,
   *  table, and code path from `cookieName`/`sessions` — `requireAdminSession`
   *  reads only this one and `requireMerchantAuth` never reads it at all, so
   *  an admin session can never be resolved as merchant authority. */
  adminCookieName: string;
  /** Deliberately shorter than a merchant session's 12h — a minor extra
   *  caution for the higher-privilege plane. */
  adminSessionTtlHours: number;
  /** SEC-2: idle window for staff, shorter than a merchant's. */
  adminSessionIdleMinutes: number;
  adminPendingSessionTtlMinutes: number;
  adminOtpTtlMinutes: number;
  adminOtpCodeLength: number;
  adminOtpMaxAttempts: number;

  /** Cookie carrying an `admin_impersonation_grants` token — the third,
   *  distinct cookie in the system. Read only by `requireMerchantAuth`, and
   *  never by `requireAdminSession`: the privilege drop is structural, not a
   *  flag that could fail to be cleared. */
  impersonationCookieName: string;
  /** Bounded lifetime of a "view as merchant" grant. Checked on every
   *  lookup — there is no "until logout" path. */
  impersonationTtlMinutes: number;

  /** Base URL of apps/settlement's internal HTTP server, reachable only
   *  inside the compose network. The API delegates settlement operations
   *  (batch runs, balance refreshes) through this. */
  settlementInternalUrl: string;
  /** Bearer token for that internal server. Required in production, same
   *  posture the retired `internalApiToken` had. */
  settlementInternalToken: string;
  /** Timeout for an internal settlement call. Generous on purpose: a full
   *  daily batch across every merchant genuinely takes longer than a typical
   *  API-latency budget. */
  settlementInternalRequestTimeoutMs: number;

  /** Base URL of apps/web's hosted checkout, used only to build the
   *  convenience `url` field on a created payment link — the API itself
   *  has no other reason to know where apps/web is hosted, and no route
   *  redirects there. Default matches Vite's own default dev port. */
  checkoutBaseUrl: string;
  /** How long a payment link stays 'reserved' (claimed by an in-flight pay
   *  attempt) before it self-expires back to claimable, closing the gap
   *  between claim and finalize without a sweep job. */
  paymentLinkReservationTimeoutSeconds: number;

  /** Base64-encoded 32 raw bytes, the single application-level AES-256-GCM
   *  key `webhooks/secretCrypto.ts` uses to encrypt/decrypt
   *  `webhook_endpoints.secret_ciphertext`. Required in every environment
   *  (not just production) — the platform must be able to actually encrypt
   *  and later recover a webhook secret's plaintext at send time, so there
   *  is no "dev doesn't need this" story the way there is for
   *  `settlementInternalToken`. `loadConfig` decodes and validates the length,
   *  failing boot on a missing or malformed value rather than accepting
   *  garbage and failing later at first-delivery time. Callers pass
   *  `Buffer.from(config.webhookSecretEncryptionKey, "base64")` to
   *  `encryptSecret`/`decryptSecret`, which take a `Buffer` key. */
  webhookSecretEncryptionKey: string;
  /** Terminal-failure threshold for a single webhook_deliveries row — the
   *  attempt at which status flips from 'pending' to 'exhausted' instead of
   *  scheduling another retry. */
  webhookMaxAttempts: number;
  /** Exponential backoff base (attempt 1's delay), milliseconds. */
  webhookBackoffBaseMs: number;
  /** Exponential backoff cap — no retry ever waits longer than this,
   *  milliseconds. */
  webhookBackoffCapMs: number;
  /** How often the dispatcher's poll-fallback timer runs a dispatch pass,
   *  independent of LISTEN/NOTIFY — the safety net that guarantees no event
   *  is stuck forever even if a NOTIFY is missed. */
  webhookPollIntervalMs: number;
  /** Per-delivery-attempt HTTP timeout passed to the transport, milliseconds. */
  webhookRequestTimeoutMs: number;

  /** Shared secret the acquirer signs its async callbacks with
   *  (routes/acquirerCallbacks.ts). Platform-level, not per-merchant —
   *  unlike webhookSecretEncryptionKey, there is exactly one acquirer
   *  relationship, not one secret per registered endpoint. */
  acquirerCallbackSigningSecret: string;
  /** True only when the API sits behind our own reverse proxy (the prod
   *  compose sets TRUST_PROXY=true). Then `request.ip` is read from
   *  X-Forwarded-For, but only entries added by a peer in
   *  `trustProxyAddresses` (proxy-addr names or CIDRs; default: the private
   *  ranges a compose network uses). Off by default: a directly reachable
   *  API that trusted the header would let a client pick its own IP and
   *  dodge every per-IP limit (SEC-1). */
  trustProxy: boolean;
  trustProxyAddresses: string;

  /** Login / OTP brute-force limits (auth/throttle.ts, SEC-1). Failures per
   *  (client IP + account) and per client IP within `loginFailureWindowSeconds`
   *  get a 429; `loginLockoutThreshold` failures for one account within
   *  `loginLockoutWindowMinutes` lock it for `loginLockoutMinutes`. */
  loginFailureWindowSeconds: number;
  loginMaxFailuresPerIpAccount: number;
  loginMaxFailuresPerIp: number;
  loginLockoutThreshold: number;
  loginLockoutWindowMinutes: number;
  loginLockoutMinutes: number;
}

function parseNodeEnv(value: string | undefined): Config["nodeEnv"] {
  if (value === "production" || value === "test" || value === "development") {
    return value;
  }
  return "development";
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`loadConfig: expected an integer, got "${value}"`);
  }
  return parsed;
}

function parseFloatEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`loadConfig: expected a number, got "${value}"`);
  }
  return parsed;
}

function parseAssistantEffort(value: string | undefined): "low" | "medium" | "high" {
  return value === "medium" || value === "high" ? value : "low";
}

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

/** base64("dev-only-webhook-key-not-for-prd"): exactly 32 bytes, as
 *  parseWebhookSecretEncryptionKey requires. Never used in production. */
const DEV_FALLBACK_WEBHOOK_KEY_B64 = "ZGV2LW9ubHktd2ViaG9vay1rZXktbm90LWZvci1wcmQ=";

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Secret values that are public — in this repo, its git history, or the
 *  example env files — and so must never authenticate anything in
 *  production (SEC-4). The acqsec_sandbox_ value was committed in
 *  ops/.env.docker (669af52) and stays readable in history: it is
 *  refused here and must be rotated, see docs/challenge/SECURITY.md. */
const KNOWN_PUBLIC_SECRETS: ReadonlySet<string> = new Set([
  "acqsec_sandbox_f8c3a1e6b9d24f7081c5e3a9b7d4f602",
  "dev-only-acquirer-secret-not-for-production",
  "dev-only-settlement-token-not-for-production",
  DEV_FALLBACK_WEBHOOK_KEY_B64,
  "change-me",
]);

/** @throws in production when `value` is one of KNOWN_PUBLIC_SECRETS. */
function refusePublicSecret(nodeEnv: Config["nodeEnv"], name: string, value: string | undefined): void {
  if (nodeEnv === "production" && value !== undefined && KNOWN_PUBLIC_SECRETS.has(value)) {
    throw new Error(`loadConfig: ${name} is a publicly known value (committed to the repo); rotate it`);
  }
}

/** Validates WEBHOOK_SECRET_ENCRYPTION_KEY decodes to exactly 32 raw bytes,
 *  failing fast at boot (same posture as DATABASE_URL) rather than
 *  accepting a missing/malformed key and only discovering the problem at
 *  first-delivery time. Returns the original base64 string unchanged — the
 *  Config field stays base64-encoded; callers decode to a Buffer at the
 *  point of use. */
function parseWebhookSecretEncryptionKey(
  value: string | undefined,
  name = "WEBHOOK_SECRET_ENCRYPTION_KEY",
): string {
  if (!value) {
    throw new Error(`loadConfig: ${name} environment variable is not set`);
  }
  if (!BASE64_RE.test(value)) {
    throw new Error(`loadConfig: ${name} is not valid base64`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    throw new Error(`loadConfig: ${name} must base64-decode to exactly 32 bytes, got ${decoded.length}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("loadConfig: DATABASE_URL environment variable is not set");
  }

  const nodeEnv = parseNodeEnv(env.NODE_ENV);

  // Off unless explicitly enabled: an unset NODE_ENV counts as development,
  // so defaulting on would leak codes on any box that forgets it (BUG-031).
  const otpDevExpose = parseBoolEnv(env.OTP_DEV_EXPOSE, false);
  if (nodeEnv === "production" && otpDevExpose) {
    throw new Error("loadConfig: OTP_DEV_EXPOSE must not be enabled when NODE_ENV=production");
  }

  const settlementInternalToken = env.SETTLEMENT_INTERNAL_TOKEN ?? "";
  if (nodeEnv === "production" && settlementInternalToken === "") {
    throw new Error("loadConfig: SETTLEMENT_INTERNAL_TOKEN is required when NODE_ENV=production");
  }

  const acquirerCallbackSigningSecret = env.ACQUIRER_CALLBACK_SIGNING_SECRET ?? "";
  if (nodeEnv === "production" && acquirerCallbackSigningSecret === "") {
    throw new Error("loadConfig: ACQUIRER_CALLBACK_SIGNING_SECRET is required when NODE_ENV=production");
  }

  refusePublicSecret(nodeEnv, "SETTLEMENT_INTERNAL_TOKEN", settlementInternalToken);
  refusePublicSecret(nodeEnv, "ACQUIRER_CALLBACK_SIGNING_SECRET", acquirerCallbackSigningSecret);
  refusePublicSecret(nodeEnv, "WEBHOOK_SECRET_ENCRYPTION_KEY", env.WEBHOOK_SECRET_ENCRYPTION_KEY);
  refusePublicSecret(nodeEnv, "KYC_ENCRYPTION_KEY", env.KYC_ENCRYPTION_KEY);

  const webhookSecretEncryptionKey = parseWebhookSecretEncryptionKey(
    env.WEBHOOK_SECRET_ENCRYPTION_KEY || (nodeEnv !== "production" ? DEV_FALLBACK_WEBHOOK_KEY_B64 : undefined),
  );

  return {
    nodeEnv,
    port: parseIntEnv(env.PORT, 3000),
    databaseUrl,

    pgPoolMax: parseIntEnv(env.PG_POOL_MAX, 5),
    pgPoolMin: parseIntEnv(env.PG_POOL_MIN, 0),
    pgPoolIdleTimeoutMs: parseIntEnv(env.PG_POOL_IDLE_TIMEOUT_MS, 30_000),
    pgPoolConnectionTimeoutMs: parseIntEnv(env.PG_POOL_CONNECTION_TIMEOUT_MS, 5_000),
    pgStatementTimeoutMs: parseIntEnv(env.PG_STATEMENT_TIMEOUT_MS, 30_000),
    pgIdleInTransactionTimeoutMs: parseIntEnv(env.PG_IDLE_IN_TRANSACTION_TIMEOUT_MS, 60_000),
    shutdownTimeoutMs: parseIntEnv(env.SHUTDOWN_TIMEOUT_MS, 25_000),
    anthropicApiKey: (env.ANTHROPIC_API_KEY ?? "").replace(/[^\x21-\x7e]/g, ""),
    assistantModel: env.ASSISTANT_MODEL || "claude-opus-5-5",
    assistantMaxTokens: parseIntEnv(env.ASSISTANT_MAX_TOKENS, 1024),
    assistantEffort: parseAssistantEffort(env.ASSISTANT_EFFORT),
    assistantMaxToolRounds: parseIntEnv(env.ASSISTANT_MAX_TOOL_ROUNDS, 3),
    assistantMaxHistory: parseIntEnv(env.ASSISTANT_MAX_HISTORY, 12),
    assistantMaxMessageChars: parseIntEnv(env.ASSISTANT_MAX_MESSAGE_CHARS, 2000),
    assistantPerMinute: parseIntEnv(env.ASSISTANT_PER_MINUTE, 6),
    assistantPerDay: parseIntEnv(env.ASSISTANT_PER_DAY, 100),

    apiMaxInFlight: parseIntEnv(env.API_MAX_IN_FLIGHT, 64),
    apiRetryAfterSeconds: parseIntEnv(env.API_RETRY_AFTER_SECONDS, 1),

    httpBodyLimitBytes: parseIntEnv(env.HTTP_BODY_LIMIT_BYTES, 1_048_576),
    adjustmentImportBodyLimitBytes: parseIntEnv(env.ADJUSTMENT_IMPORT_BODY_LIMIT_BYTES, 5_242_880),
    httpConnectionTimeoutMs: parseIntEnv(env.HTTP_CONNECTION_TIMEOUT_MS, 60_000),
    httpHeadersTimeoutMs: parseIntEnv(env.HTTP_HEADERS_TIMEOUT_MS, 20_000),
    httpRequestTimeoutMs: parseIntEnv(env.HTTP_REQUEST_TIMEOUT_MS, 120_000),
    httpKeepAliveTimeoutMs: parseIntEnv(env.HTTP_KEEP_ALIVE_TIMEOUT_MS, 72_000),

    sessionTtlHours: parseIntEnv(env.SESSION_TTL_HOURS, 12),
    sessionIdleMinutes: parseIntEnv(env.SESSION_IDLE_MINUTES, 60),
    pendingSessionTtlMinutes: parseIntEnv(env.PENDING_SESSION_TTL_MINUTES, 10),
    otpTtlMinutes: parseIntEnv(env.OTP_TTL_MINUTES, 5),
    otpCodeLength: parseIntEnv(env.OTP_CODE_LENGTH, 6),
    otpMaxAttempts: parseIntEnv(env.OTP_MAX_ATTEMPTS, 5),
    otpDevExpose,

    smtpHost: env.SMTP_HOST ?? "",
    smtpPort: parseIntEnv(env.SMTP_PORT, 587),
    smtpSecure: parseBoolEnv(env.SMTP_SECURE, false),
    smtpUser: env.SMTP_USER ?? "",
    smtpPassword: env.SMTP_PASSWORD ?? "",
    mailFrom: env.MAIL_FROM || "FilsPay <no-reply@filspay.local>",

    argon2MemoryKib: parseIntEnv(env.ARGON2_MEMORY_KIB, 19_456),
    argon2TimeCost: parseIntEnv(env.ARGON2_TIME_COST, 2),
    argon2Parallelism: parseIntEnv(env.ARGON2_PARALLELISM, 1),

    kycUploadDir: env.KYC_UPLOAD_DIR ?? "./data/kyc",
    kycMaxFileSizeBytes: parseIntEnv(env.KYC_MAX_FILE_SIZE_BYTES, 8_388_608),
    kycEncryptionKey: env.KYC_ENCRYPTION_KEY
      ? parseWebhookSecretEncryptionKey(env.KYC_ENCRYPTION_KEY, "KYC_ENCRYPTION_KEY")
      : webhookSecretEncryptionKey,

    acquirerLatencyMinMs: parseIntEnv(env.ACQUIRER_LATENCY_MIN_MS, 100),
    acquirerLatencyMaxMs: parseIntEnv(env.ACQUIRER_LATENCY_MAX_MS, 400),
    acquirerFailureRate: parseFloatEnv(env.ACQUIRER_FAILURE_RATE, 0.02),
    acquirerRngSeed:
      env.ACQUIRER_RNG_SEED !== undefined && env.ACQUIRER_RNG_SEED !== ""
        ? parseIntEnv(env.ACQUIRER_RNG_SEED, 0)
        : null,

    cookieName: env.COOKIE_NAME ?? "fp_sid",
    cookieSecure: parseBoolEnv(env.COOKIE_SECURE, nodeEnv === "production"),

    adminCookieName: env.ADMIN_COOKIE_NAME ?? "fp_admin_sid",
    adminSessionTtlHours: parseIntEnv(env.ADMIN_SESSION_TTL_HOURS, 8),
    adminSessionIdleMinutes: parseIntEnv(env.ADMIN_SESSION_IDLE_MINUTES, 30),
    adminPendingSessionTtlMinutes: parseIntEnv(env.ADMIN_PENDING_SESSION_TTL_MINUTES, 10),
    adminOtpTtlMinutes: parseIntEnv(env.ADMIN_OTP_TTL_MINUTES, 5),
    adminOtpCodeLength: parseIntEnv(env.ADMIN_OTP_CODE_LENGTH, 6),
    adminOtpMaxAttempts: parseIntEnv(env.ADMIN_OTP_MAX_ATTEMPTS, 5),

    impersonationCookieName: env.IMPERSONATION_COOKIE_NAME ?? "fp_impersonation",
    impersonationTtlMinutes: parseIntEnv(env.IMPERSONATION_TTL_MINUTES, 15),

    settlementInternalUrl: env.SETTLEMENT_INTERNAL_URL ?? "http://settlement:8091",
    settlementInternalToken,
    settlementInternalRequestTimeoutMs: parseIntEnv(env.SETTLEMENT_INTERNAL_REQUEST_TIMEOUT_MS, 30_000),

    checkoutBaseUrl: env.CHECKOUT_BASE_URL ?? "http://localhost:5173",
    paymentLinkReservationTimeoutSeconds: parseIntEnv(env.PAYMENT_LINK_RESERVATION_TIMEOUT_SECONDS, 60),

    webhookSecretEncryptionKey,
    webhookMaxAttempts: parseIntEnv(env.WEBHOOK_MAX_ATTEMPTS, 8),
    webhookBackoffBaseMs: parseIntEnv(env.WEBHOOK_BACKOFF_BASE_MS, 30_000),
    webhookBackoffCapMs: parseIntEnv(env.WEBHOOK_BACKOFF_CAP_MS, 21_600_000),
    webhookPollIntervalMs: parseIntEnv(env.WEBHOOK_POLL_INTERVAL_MS, 5_000),
    webhookRequestTimeoutMs: parseIntEnv(env.WEBHOOK_REQUEST_TIMEOUT_MS, 10_000),

    acquirerCallbackSigningSecret,
    trustProxy: parseBoolEnv(env.TRUST_PROXY, false),
    trustProxyAddresses: env.TRUST_PROXY_ADDRESSES || "loopback,linklocal,uniquelocal",

    loginFailureWindowSeconds: parseIntEnv(env.LOGIN_FAILURE_WINDOW_SECONDS, 60),
    loginMaxFailuresPerIpAccount: parseIntEnv(env.LOGIN_MAX_FAILURES_PER_IP_ACCOUNT, 5),
    loginMaxFailuresPerIp: parseIntEnv(env.LOGIN_MAX_FAILURES_PER_IP, 30),
    loginLockoutThreshold: parseIntEnv(env.LOGIN_LOCKOUT_THRESHOLD, 10),
    loginLockoutWindowMinutes: parseIntEnv(env.LOGIN_LOCKOUT_WINDOW_MINUTES, 15),
    loginLockoutMinutes: parseIntEnv(env.LOGIN_LOCKOUT_MINUTES, 15),
  };
}
