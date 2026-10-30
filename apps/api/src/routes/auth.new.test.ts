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
