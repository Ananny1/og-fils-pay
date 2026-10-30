import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { isReady, markDbConnectedOnce, resetReadyStateForTests } from "../health/state.js";

// healthz never touches the database. readyz does (OPS-001), and this file
// deliberately uses an unreachable DATABASE_URL to prove a booted instance
// whose database is gone reports not-ready. The happy path (database up) is
// in health.new.test.ts.
const config = loadConfig({
  DATABASE_URL: "postgres://unused/unused",
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
const app = buildApp(config, pool);

/** Liveness never touches the DB. */
test("GET /healthz returns 200 immediately, independent of readiness state", async () => {
  const res = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, "ok");
});

test("GET /readyz is 503 before the boot-time DB check has run", () => {
  resetReadyStateForTests();
  assert.equal(isReady(), false);
});

// Changed for OPS-001: this test used to assert the opposite — that /readyz
// stays 200 forever once the boot latch is set, "never re-checking" the
// database. That encoded the bug: a database outage after boot was invisible.
test("GET /readyz re-checks the live database after boot instead of trusting the boot latch", async () => {
  resetReadyStateForTests();

  const before = await app.inject({ method: "GET", url: "/readyz" });
  assert.equal(before.statusCode, 503);
  assert.equal(before.json().status, "not_ready");

  markDbConnectedOnce();

  // The database behind this pool is unreachable, so even with the boot
  // latch set the instance must not claim to be ready.
  const after = await app.inject({ method: "GET", url: "/readyz" });
  assert.equal(after.statusCode, 503);
  assert.equal(after.json().reason, "database_unreachable");
});
