import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { markDbConnectedOnce, resetReadyStateForTests } from "../health/state.js";

// OPS-001: /readyz was a one-way boot latch. Once the API had connected to
// Postgres once, it answered "ready" forever, even with the database gone.
// These tests pin the fixed behaviour: readiness = booted AND the database
// answers right now.

const baseEnv = {
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
};

test("GET /readyz is 503 when the database is unreachable, even after a successful boot", async () => {
  // Port 1 on localhost: nothing listens there, so every connect is refused at once.
  const config = loadConfig({ ...baseEnv, DATABASE_URL: "postgres://x:y@127.0.0.1:1/none" });
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 1000 });
  pool.on("error", () => {});
  const app = buildApp(config, pool);
  try {
    resetReadyStateForTests();
    markDbConnectedOnce(); // the process DID connect at boot...

    const res = await app.inject({ method: "GET", url: "/readyz" });
    // ...but the database is down now, so the instance must not report ready.
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().status, "not_ready");
    assert.equal(res.json().reason, "database_unreachable");
  } finally {
    await app.close();
    await pool.end();
  }
});

test("GET /readyz is 200 when booted and the database answers", { skip: !process.env.DATABASE_URL }, async () => {
  const config = loadConfig({ ...baseEnv, DATABASE_URL: process.env.DATABASE_URL });
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
  const app = buildApp(config, pool);
  try {
    resetReadyStateForTests();
    const before = await app.inject({ method: "GET", url: "/readyz" });
    assert.equal(before.statusCode, 503, "not ready before the boot check has run");

    markDbConnectedOnce();
    const res = await app.inject({ method: "GET", url: "/readyz" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, "ready");
  } finally {
    await app.close();
    await pool.end();
  }
});
