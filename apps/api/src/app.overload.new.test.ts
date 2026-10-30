import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";

// OPS-002: overload protection. With 0.5 vCPU the API must turn excess
// requests away at once (503 + Retry-After) instead of queuing them until
// every request times out. These tests need no database.

const baseEnv = {
  DATABASE_URL: "postgres://unused/unused",
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("requests above API_MAX_IN_FLIGHT get 503 + Retry-After at once; capacity frees up afterwards", { timeout: 5000 }, async () => {
  const config = loadConfig({ ...baseEnv, API_MAX_IN_FLIGHT: "2" });
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
  const app = buildApp(config, pool);
  const gate = deferred();
  app.get("/test/slow", async () => {
    await gate.promise;
    return { ok: true };
  });

  try {
    const first = app.inject({ method: "GET", url: "/test/slow" });
    const second = app.inject({ method: "GET", url: "/test/slow" });
    await new Promise((r) => setTimeout(r, 20)); // let both reach the handler

    const started = Date.now();
    const third = await app.inject({ method: "GET", url: "/test/slow" });
    assert.equal(third.statusCode, 503);
    assert.equal(third.headers["retry-after"], "1");
    assert.equal(third.json().error, "service_unavailable");
    assert.ok(Date.now() - started < 200, "rejection must be immediate, not queued");

    // Health probes are never shed, so Docker/nginx can still see the instance.
    const health = await app.inject({ method: "GET", url: "/healthz" });
    assert.equal(health.statusCode, 200);

    gate.resolve();
    assert.equal((await first).statusCode, 200);
    assert.equal((await second).statusCode, 200);

    // Slots were released: a new request is accepted again.
    const after = await app.inject({ method: "GET", url: "/test/slow" });
    assert.equal(after.statusCode, 200);
  } finally {
    await app.close();
    await pool.end();
  }
});

// BODY_LIMIT_BYTES is enforced by Fastify itself; at the edge nginx answers 413 for bodies over client_max_body_size.

test(
  "createPool applies statement_timeout and idle_in_transaction_session_timeout to every connection",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const config = loadConfig({
      ...baseEnv,
      DATABASE_URL: process.env.DATABASE_URL,
      PG_STATEMENT_TIMEOUT_MS: "1500",
      PG_IDLE_IN_TRANSACTION_TIMEOUT_MS: "4000",
    });
    const pool = createPool(config);
    try {
      const st = await pool.query<{ statement_timeout: string }>("SHOW statement_timeout");
      assert.equal(st.rows[0]?.statement_timeout, "1500ms");
      const it = await pool.query<{ idle_in_transaction_session_timeout: string }>(
        "SHOW idle_in_transaction_session_timeout",
      );
      assert.equal(it.rows[0]?.idle_in_transaction_session_timeout, "4s");
      await assert.rejects(pool.query("SELECT pg_sleep(3)"), /statement timeout/);
    } finally {
      await pool.end();
    }
  },
);
