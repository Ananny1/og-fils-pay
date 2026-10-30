/**
 * Regression tests for the merchant login flow (password -> OTP -> session),
 * via `app.inject(...)` against a real, migrated Postgres. Requires
 * DATABASE_URL (run `npm run migrate` first).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("auth.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

function parseCookie(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!header) throw new Error("expected a Set-Cookie header in the response");
  return header.split(";")[0] as string;
}

async function signup(label: string, password: string, email = uniqueEmail(label)) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `Auth Test ${label} ${randomUUID().slice(0, 8)}`,
        registrationNumber: `RC-${randomUUID().slice(0, 8)}`,
        businessType: "llc",
        contactEmail: uniqueEmail("contact"),
        contactPhone: "+97300000000",
        addressLine1: "1 Test Street",
        city: "Manama",
      },
      owner: { email, password },
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json() as { merchantId: string; ownerUserId: string };
  return { merchantId: body.merchantId, ownerUserId: body.ownerUserId, email, password };
}

async function login(merchantId: string, email: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { merchantId, email, password },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { otpRequired: boolean; devOtpCode?: string };
  assert.ok(body.devOtpCode, "expected devOtpCode with OTP_DEV_EXPOSE=true");
  return { cookie: parseCookie(res.headers["set-cookie"]), code: body.devOtpCode, res };
}

// ------------------------------------------------------------ BUG-001

test("BUG-001: a pending (password ok, OTP not yet verified) cookie authenticates nothing", async () => {
  const password = "pending-session-password-1!";
  const { merchantId, email } = await signup("pending", password);
  const { cookie } = await login(merchantId, email, password);

  const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  assert.equal(me.statusCode, 401, `pre-OTP cookie reached /v1/auth/me: ${me.body}`);

  const txns = await app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie } });
  assert.equal(txns.statusCode, 401, `pre-OTP cookie reached /v1/transactions: ${txns.body}`);

  const keys = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/api-keys`,
    headers: { cookie },
    payload: { label: "should never be issued" },
  });
  assert.equal(keys.statusCode, 401, `pre-OTP cookie issued an API key: ${keys.body}`);
});

test("BUG-001: the same cookie works once the OTP is verified", async () => {
  const password = "pending-session-password-2!";
  const { merchantId, email } = await signup("promoted", password);
  const { cookie, code } = await login(merchantId, email, password);

  const verify = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    headers: { cookie },
    payload: { code },
  });
  assert.equal(verify.statusCode, 200, verify.body);

  const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().merchant.id, merchantId);
});

// ------------------------------------------------------------ BUG-011

function wrongCodeFor(code: string): string {
  return code === "000000" ? "111111" : "000000";
}

test("BUG-011: parallel wrong OTP guesses cannot exceed max_attempts", async () => {
  const password = "parallel-otp-password-1!";
  const { merchantId, email } = await signup("otp-race", password);
  const { cookie, code } = await login(merchantId, email, password);
  const wrong = wrongCodeFor(code);

  const results = await Promise.all(
    Array.from({ length: 25 }, () =>
      app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie }, payload: { code: wrong } }),
    ),
  );
  const guessesChecked = results.filter((r) => r.statusCode === 401 && r.json().error === "invalid_code").length;
  assert.ok(
    guessesChecked <= config.otpMaxAttempts,
    `${guessesChecked} guesses were checked against the code; the cap is ${config.otpMaxAttempts}`,
  );

  const row = await pool.query<{ attempt_count: number }>(
    `SELECT c.attempt_count FROM sessions s JOIN otp_challenges c ON c.id = s.otp_challenge_id
      JOIN merchant_users mu ON mu.id = s.merchant_user_id
     WHERE mu.merchant_id = $1`,
    [merchantId],
  );
  assert.ok(row.rows[0]!.attempt_count <= config.otpMaxAttempts, `attempt_count=${row.rows[0]!.attempt_count}`);
});

test("BUG-011: the real code still works after a few wrong guesses, and the 6th guess is refused", async () => {
  const password = "otp-cap-password-1!";
  const { merchantId, email } = await signup("otp-cap", password);
  const { cookie, code } = await login(merchantId, email, password);
  const wrong = wrongCodeFor(code);

  for (let i = 0; i < config.otpMaxAttempts - 1; i++) {
    const r = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie }, payload: { code: wrong } });
    assert.equal(r.statusCode, 401, r.body);
  }
  const right = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie }, payload: { code } });
  assert.equal(right.statusCode, 200, right.body);

  const second = await signup("otp-cap-2", password);
  const l2 = await login(second.merchantId, second.email, password);
  const w2 = wrongCodeFor(l2.code);
  for (let i = 0; i < config.otpMaxAttempts; i++) {
    await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: l2.cookie }, payload: { code: w2 } });
  }
  const sixth = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    headers: { cookie: l2.cookie },
    payload: { code: l2.code },
  });
  assert.equal(sixth.statusCode, 429, `the right code after the cap must not log in: ${sixth.body}`);
});

test("BUG-011: an OTP resend keeps the guess budget already spent", async () => {
  const password = "otp-resend-password-1!";
  const { merchantId, email } = await signup("otp-resend", password);
  const { cookie, code } = await login(merchantId, email, password);
  const wrong = wrongCodeFor(code);

  for (let i = 0; i < 3; i++) {
    await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie }, payload: { code: wrong } });
  }
  // Skip the 30s resend throttle.
  await pool.query(
    `UPDATE otp_challenges SET created_at = now() - interval '31 seconds'
      WHERE id = (SELECT s.otp_challenge_id FROM sessions s JOIN merchant_users mu ON mu.id = s.merchant_user_id
                   WHERE mu.merchant_id = $1)`,
    [merchantId],
  );
  const resend = await app.inject({ method: "POST", url: "/v1/auth/otp/resend", headers: { cookie } });
  assert.equal(resend.statusCode, 200, resend.body);

  const row = await pool.query<{ attempt_count: number }>(
    `SELECT c.attempt_count FROM sessions s JOIN otp_challenges c ON c.id = s.otp_challenge_id
      JOIN merchant_users mu ON mu.id = s.merchant_user_id
     WHERE mu.merchant_id = $1`,
    [merchantId],
  );
  assert.equal(row.rows[0]!.attempt_count, 3, "a resend reset the guess budget");
});

// ------------------------------------------------------------ BUG-002

test("BUG-002: with the same email at two merchants, the OTP and session belong to the merchant that logged in", async () => {
  const email = uniqueEmail("shared-otp");
  const a = await signup("shared-a", "password-of-merchant-a-111", email);
  const b = await signup("shared-b", "password-of-merchant-b-222", email);

  const { cookie, code } = await login(b.merchantId, email, b.password);

  const challenge = await pool.query<{ merchant_user_id: string }>(
    `SELECT c.merchant_user_id
       FROM sessions s JOIN otp_challenges c ON c.id = s.otp_challenge_id
      WHERE s.merchant_user_id IN ($1, $2)
      ORDER BY s.created_at DESC LIMIT 1`,
    [a.ownerUserId, b.ownerUserId],
  );
  assert.equal(challenge.rows[0]?.merchant_user_id, b.ownerUserId, "OTP challenge issued to the wrong merchant's user");

  const verify = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    headers: { cookie },
    payload: { code },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  assert.equal(verify.json().merchantId, b.merchantId, "verified into the wrong merchant");

  const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().merchant.id, b.merchantId);
  assert.equal(me.json().merchantUserId, b.ownerUserId);
});
