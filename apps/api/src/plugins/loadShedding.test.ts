/**
 * CAP-2: excess load is turned away fast (503 + Retry-After), not queued
 * until it times out. Uses a real Postgres for the pool-wait case, so this
 * file requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("loadShedding.test.ts requires DATABASE_URL");
}

function testConfig(extra: Record<string, string>) {
  return loadConfig({
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
    ...extra,
  });
}

test("requests over API_MAX_IN_FLIGHT get an immediate 503 with Retry-After; health checks are never shed", async () => {
  const config = testConfig({ API_MAX_IN_FLIGHT: "2" });
  assert.equal(config.apiMaxInFlight, 2);
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const app = buildApp(config, pool);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  app.get("/test/slow", async () => {
    await gate;
    return { ok: true };
  });

  try {
    await app.ready();
    // Two slow requests fill both slots.
    const slow1 = app.inject({ method: "GET", url: "/test/slow" });
    const slow2 = app.inject({ method: "GET", url: "/test/slow" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const started = Date.now();
    const shed = await app.inject({ method: "GET", url: "/v1/payment-links/plink_does_not_matter" });
    assert.equal(shed.statusCode, 503);
    assert.equal(shed.headers["retry-after"], "1");
    assert.equal(shed.json().error, "service_unavailable");
    assert.ok(Date.now() - started < 500, "a shed request must be answered at once");

    const health = await app.inject({ method: "GET", url: "/healthz" });
    assert.equal(health.statusCode, 200);

    release();
    assert.equal((await slow1).statusCode, 200);
    assert.equal((await slow2).statusCode, 200);

    // Slots are given back once responses close.
    const after = await app.inject({ method: "GET", url: "/test/slow" });
    assert.equal(after.statusCode, 200);
  } finally {
    await app.close();
    await pool.end();
  }
});

test("a request that cannot get a DB connection in time gets 503 + Retry-After, not a 500", async () => {
  const config = testConfig({});
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 200 });
  const app = buildApp(config, pool);
  const held = await pool.connect();
  try {
    const res = await app.inject({ method: "GET", url: "/v1/payment-links/plink_pool_is_full" });
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers["retry-after"], "1");
    assert.equal(res.json().error, "service_unavailable");
  } finally {
    held.release();
    await app.close();
    await pool.end();
  }
});
