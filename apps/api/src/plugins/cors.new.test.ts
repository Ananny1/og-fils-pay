import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

// CORS never touches the database, so an unreachable DATABASE_URL is fine.
const config = loadConfig({
  DATABASE_URL: "postgres://unused/unused",
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
const app = buildApp(config, pool);

test("preflight from the dashboard origin is answered, not 404", async () => {
  const res = await app.inject({
    method: "OPTIONS",
    url: "/v1/auth/login",
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], "http://localhost:5173");
  assert.equal(res.headers["access-control-allow-credentials"], "true");
  assert.match(String(res.headers["access-control-allow-methods"]), /POST/);
  assert.match(String(res.headers["access-control-allow-headers"]), /content-type/i);
});

test("admin console origin is allowed too", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/healthz",
    headers: { origin: "http://localhost:5174" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["access-control-allow-origin"], "http://localhost:5174");
  assert.equal(res.headers["access-control-allow-credentials"], "true");
  assert.match(String(res.headers["vary"]), /Origin/);
});

test("an unknown origin gets no CORS headers (cookie must not be exposed to it)", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/healthz",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
  assert.equal(res.headers["access-control-allow-credentials"], undefined);
});
