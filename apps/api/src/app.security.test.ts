/**
 * SEC-3: security headers, no internal details in error replies, request
 * size limits, slow-connection timeouts, and session cookie flags.
 * Requires `DATABASE_URL` (a real, migrated Postgres) for the cookie test.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AppError } from "./lib/errors.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("app.security.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const baseEnv = {
  DATABASE_URL: databaseUrl,
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  SETTLEMENT_INTERNAL_TOKEN: "test-internal-token",
  ACQUIRER_CALLBACK_SIGNING_SECRET: "test-acquirer-secret",
};

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

/** A production app with two extra routes that fail the way a real bug or
 *  a down dependency would, to see what the client gets back. */
function buildProdApp(extraEnv: Record<string, string> = {}) {
  const app = buildApp(loadConfig({ ...baseEnv, NODE_ENV: "production", ...extraEnv }), pool);
  app.get("/v1/test-only/pg-failure", async () => {
    const err = new Error('duplicate key value violates unique constraint "merchants_pkey"') as Error & {
      code: string;
      constraint: string;
    };
    err.code = "23505";
    err.constraint = "merchants_pkey";
    throw err;
  });
  app.get("/v1/test-only/upstream-failure", async () => {
    throw new AppError(502, "settlement_unreachable", "settlement internal call to /internal/run failed: ECONNREFUSED 10.0.0.7:8091");
  });
  return app;
}

const prodApp = buildProdApp();
const devApp = buildApp(loadConfig({ ...baseEnv, NODE_ENV: "development" }), pool);

test.after(async () => {
  await prodApp.close();
  await devApp.close();
  await pool.end();
});

test("every response carries the security headers", async () => {
  for (const url of ["/healthz", "/v1/auth/me", "/v1/does-not-exist"]) {
    const res = await prodApp.inject({ method: "GET", url });
    assert.equal(res.headers["x-content-type-options"], "nosniff", url);
    assert.equal(res.headers["x-frame-options"], "DENY", url);
    assert.equal(res.headers["referrer-policy"], "no-referrer", url);
    assert.equal(res.headers["content-security-policy"], "default-src 'none'; frame-ancestors 'none'", url);
    assert.equal(res.headers["x-powered-by"], undefined, url);
  }
});

test("/v1 responses are never cached; HSTS only in production", async () => {
  const prod = await prodApp.inject({ method: "GET", url: "/v1/auth/me" });
  assert.equal(prod.headers["cache-control"], "no-store");
  assert.equal(prod.headers["strict-transport-security"], "max-age=31536000; includeSubDomains");

  const dev = await devApp.inject({ method: "GET", url: "/v1/auth/me" });
  assert.equal(dev.headers["cache-control"], "no-store");
  assert.equal(dev.headers["strict-transport-security"], undefined);
});

test("production 500: no SQL text or constraint name reaches the client", async () => {
  const res = await prodApp.inject({ method: "GET", url: "/v1/test-only/pg-failure" });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: "internal_error" });
  assert.doesNotMatch(res.body, /constraint|merchants_pkey|duplicate key|stack/i);
});

test("production 5xx AppError: keeps the code, drops the internal message", async () => {
  const res = await prodApp.inject({ method: "GET", url: "/v1/test-only/upstream-failure" });
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.json(), { error: "settlement_unreachable" });
  assert.doesNotMatch(res.body, /ECONNREFUSED|10\.0\.0\.7|internal\/run/);
});

test("malformed JSON is a 400, not a 500", async () => {
  const res = await prodApp.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { "content-type": "application/json" },
    payload: "{not json",
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error, "bad_request");
});

test("a body over the 1 MiB limit is a 413, not a 500", async () => {
  const res = await prodApp.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ email: "x".repeat(1_100_000) }),
  });
  assert.equal(res.statusCode, 413, res.body);
  assert.equal(res.json().error, "payload_too_large");
});

test("the CSV import route accepts a body above 1 MiB (its own, larger limit)", async () => {
  // No admin cookie: if the body is accepted, the auth check answers 401.
  const res = await prodApp.inject({
    method: "POST",
    url: "/v1/admin/adjustment-imports/",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ csvContent: "x".repeat(2_000_000) }),
  });
  assert.equal(res.statusCode, 401, res.body);
});

test("server timeouts are set (slow-loris requests are cut off)", async () => {
  const app = buildProdApp();
  await app.ready();
  assert.equal(app.server.requestTimeout, 120_000);
  assert.equal(app.server.headersTimeout, 20_000);
  assert.equal(app.server.keepAliveTimeout, 72_000);
  assert.equal(app.server.timeout, 60_000);
  await app.close();
});

test("an idle half-sent request is dropped after the connection timeout", async () => {
  const app = buildProdApp({ HTTP_CONNECTION_TIMEOUT_MS: "300" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  const started = Date.now();
  const closed = await new Promise<boolean>((resolve) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write("GET /healthz HTTP/1.1\r\nHost: x\r\n"); // headers never finished
    });
    const guard = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 5_000);
    socket.on("close", () => {
      clearTimeout(guard);
      resolve(true);
    });
    socket.on("error", () => undefined);
  });
  await app.close();
  assert.equal(closed, true, "server kept the half-open connection");
  assert.ok(Date.now() - started < 5_000);
});

test("session cookie is HttpOnly, Secure and SameSite in production", async () => {
  const email = `sec3-${randomUUID()}@example.test`;
  const password = "correct horse battery staple 1!";
  const signup = await prodApp.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: "Sec3 Co",
        registrationNumber: `RC-${randomUUID().slice(0, 8)}`,
        businessType: "llc",
        contactEmail: email,
        contactPhone: "+97300000000",
        addressLine1: "1 Test Street",
        city: "Manama",
      },
      owner: { email, password },
    },
  });
  assert.equal(signup.statusCode, 201, signup.body);
  const login = await prodApp.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { merchantId: signup.json().merchantId, email, password },
  });
  assert.equal(login.statusCode, 200, login.body);
  const setCookie = String(login.headers["set-cookie"]);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
});
