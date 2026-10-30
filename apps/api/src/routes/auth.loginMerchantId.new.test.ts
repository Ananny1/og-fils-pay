/**
 * BUG-102: POST /v1/auth/login crashed with 500 when merchantId was not a
 * UUID string (Postgres rejects the uuid cast; an object crashed in the
 * throttle key). Requires DATABASE_URL (run `npm run migrate` first).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("auth.loginMerchantId.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

function login(merchantId: unknown) {
  return app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { merchantId, email: `bug102-${randomUUID()}@example.test`, password: "whatever-password-1!" },
  });
}

test("BUG-102: a merchantId that is not a UUID gets the generic 401, not a 500", async () => {
  const res = await login(`nope-${randomUUID().slice(0, 8)}`);
  assert.equal(res.statusCode, 401, res.body);
  assert.equal((res.json() as { error: string }).error, "invalid_credentials");
});

test("BUG-102: a merchantId that is an object is a 400 bad request, not a 500", async () => {
  const res = await login({ $ne: null });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal((res.json() as { error: string }).error, "invalid_request");
});

test("BUG-102: a well-formed but unknown merchantId still gets the generic 401", async () => {
  const res = await login(randomUUID());
  assert.equal(res.statusCode, 401, res.body);
  assert.equal((res.json() as { error: string }).error, "invalid_credentials");
});
