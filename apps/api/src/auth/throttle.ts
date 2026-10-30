import type { Pool } from "pg";
import type { Config } from "../config.js";
import { TooManyRequestsError } from "../lib/errors.js";

/**
 * Brute-force limits for the merchant and the admin login (SEC-1). Every
 * failed step (wrong password, wrong OTP code) is a row in `auth_failures`;
 * an account with too many recent failures gets a row in `auth_lockouts`.
 * Three limits, all answered with the same 429 so none of them tells an
 * attacker anything:
 *
 * - per (client IP + account): `loginMaxFailuresPerIpAccount` per window;
 * - per client IP, across accounts (password spraying): `loginMaxFailuresPerIp`;
 * - per account, across IPs: `loginLockoutThreshold` failures in
 *   `loginLockoutWindowMinutes` lock it for `loginLockoutMinutes`.
 *
 * The account key (`subject`) is built from what the client typed, whether or
 * not such an account exists, so an unknown email is limited and locked
 * exactly like a real one. State is in Postgres so all API instances share it.
 */

export type AuthPlane = "merchant" | "admin";

export interface ThrottleKey {
  plane: AuthPlane;
  ipAddress: string;
  subject: string;
}

const GENERIC_MESSAGE = "Too many attempts. Try again later.";
/** Typed emails can be any length; cap what we store and index. */
const MAX_SUBJECT_LENGTH = 320;
/** How long failure / expired-lock rows are kept before the cleanup drops them. */
const RETENTION = "1 day";
const CLEANUP_INTERVAL_MS = 10 * 60_000;
let lastCleanupAt = 0;

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function merchantSubject(merchantId: string, email: string): string {
  return `${merchantId.trim().toLowerCase()}:${normaliseEmail(email)}`.slice(0, MAX_SUBJECT_LENGTH);
}

export function adminSubject(email: string): string {
  return normaliseEmail(email).slice(0, MAX_SUBJECT_LENGTH);
}

interface Counts {
  locked_seconds: number | null;
  account: number;
  ip_account: number;
  ip: number;
}

async function readCounts(db: Pool, config: Config, key: ThrottleKey): Promise<Counts> {
  const result = await db.query<Counts>(
    `SELECT
       (SELECT ceil(extract(epoch FROM locked_until - now()))::int FROM auth_lockouts
         WHERE plane = $1 AND subject = $3 AND locked_until > now()) AS locked_seconds,
       (SELECT count(*)::int FROM auth_failures
         WHERE plane = $1 AND subject = $3
           AND created_at > now() - make_interval(mins => $5)) AS account,
       (SELECT count(*)::int FROM auth_failures
         WHERE plane = $1 AND subject = $3 AND ip_address = $2
           AND created_at > now() - make_interval(secs => $4)) AS ip_account,
       (SELECT count(*)::int FROM auth_failures
         WHERE plane = $1 AND ip_address = $2
           AND created_at > now() - make_interval(secs => $4)) AS ip`,
    [key.plane, key.ipAddress, key.subject, config.loginFailureWindowSeconds, config.loginLockoutWindowMinutes],
  );
  return result.rows[0]!;
}

function tooMany(retryAfterSeconds: number): TooManyRequestsError {
  return new TooManyRequestsError("too_many_attempts", GENERIC_MESSAGE, Math.max(1, retryAfterSeconds));
}

/** Throws the generic 429 if this key is locked or over a limit. Read-only. */
export async function assertNotThrottled(db: Pool, config: Config, key: ThrottleKey): Promise<void> {
  const counts = await readCounts(db, config, key);
  if (counts.locked_seconds !== null) {
    throw tooMany(counts.locked_seconds);
  }
  // At the threshold but the lock row not written yet (a parallel request is about to).
  if (counts.account >= config.loginLockoutThreshold) {
    throw tooMany(config.loginLockoutMinutes * 60);
  }
  if (counts.ip_account >= config.loginMaxFailuresPerIpAccount || counts.ip >= config.loginMaxFailuresPerIp) {
    throw tooMany(config.loginFailureWindowSeconds);
  }
}

/**
 * Checks the limits, then records this attempt as a failure up front and
 * checks again, so N parallel requests can't all pass the check before any of
 * them is counted. Returns the reserved row's id: pass it to `releaseAttempt`
 * when the step turns out not to be a failure, or to `confirmFailure` when it
 * is. A request refused at the first, read-only check writes nothing.
 */
export async function reserveAttempt(db: Pool, config: Config, key: ThrottleKey): Promise<string> {
  await assertNotThrottled(db, config, key);
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO auth_failures (plane, ip_address, subject) VALUES ($1, $2, $3) RETURNING id`,
    [key.plane, key.ipAddress, key.subject],
  );
  const id = inserted.rows[0]!.id;
  const counts = await readCounts(db, config, key);
  if (
    counts.locked_seconds !== null ||
    counts.account > config.loginLockoutThreshold ||
    counts.ip_account > config.loginMaxFailuresPerIpAccount ||
    counts.ip > config.loginMaxFailuresPerIp
  ) {
    await releaseAttempt(db, id);
    throw tooMany(counts.locked_seconds ?? config.loginFailureWindowSeconds);
  }
  return id;
}

/** The reserved attempt was not a failure (right password, or not evaluated). */
export async function releaseAttempt(db: Pool, attemptId: string): Promise<void> {
  await db.query(`DELETE FROM auth_failures WHERE id = $1`, [attemptId]);
}

/** The reserved attempt failed: keep it, and lock the account if it crossed the threshold. */
export async function confirmFailure(db: Pool, config: Config, key: ThrottleKey): Promise<void> {
  await db.query(
    `INSERT INTO auth_lockouts (plane, subject, locked_until)
     SELECT $1, $2, now() + make_interval(mins => $5)
      WHERE (SELECT count(*) FROM auth_failures
              WHERE plane = $1 AND subject = $2
                AND created_at > now() - make_interval(mins => $3)) >= $4
     ON CONFLICT (plane, subject) DO UPDATE SET locked_until = EXCLUDED.locked_until`,
    [key.plane, key.subject, config.loginLockoutWindowMinutes, config.loginLockoutThreshold, config.loginLockoutMinutes],
  );
  await maybeCleanup(db);
}

/** A full login (OTP verified) succeeded: forget this account's failures and lock. */
export async function clearFailures(db: Pool, key: Pick<ThrottleKey, "plane" | "subject">): Promise<void> {
  await db.query(`DELETE FROM auth_failures WHERE plane = $1 AND subject = $2`, [key.plane, key.subject]);
  await db.query(`DELETE FROM auth_lockouts WHERE plane = $1 AND subject = $2`, [key.plane, key.subject]);
}

/** Drops old rows at most once per CLEANUP_INTERVAL_MS per process, only on the failure path. */
async function maybeCleanup(db: Pool): Promise<void> {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  await db.query(`DELETE FROM auth_failures WHERE created_at < now() - $1::interval`, [RETENTION]);
  await db.query(`DELETE FROM auth_lockouts WHERE locked_until < now() - $1::interval`, [RETENTION]);
}
