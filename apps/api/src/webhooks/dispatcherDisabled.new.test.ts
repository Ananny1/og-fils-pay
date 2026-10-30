/**
 * BUG-079: a merchant who disables (pauses) a webhook endpoint must stop
 * receiving deliveries on it. Before the fix only Step A (new rows) checked
 * `we.status = 'active'`; Step B kept sending every already-queued retry to
 * the disabled URL until it was exhausted.
 * Requires DATABASE_URL to point at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { enqueueEvent } from "@filspay/events";
import { loadConfig } from "../config.js";
import { createWebhookEndpoint } from "./create.js";
import { updateWebhookEndpoint } from "./update.js";
import { runDispatchPass } from "./dispatcher.js";
import type { WebhookTransport } from "./transport.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("dispatcherDisabled.new.test.ts requires DATABASE_URL");

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  WEBHOOK_MAX_ATTEMPTS: "5",
  WEBHOOK_BACKOFF_BASE_MS: "1000",
  WEBHOOK_BACKOFF_CAP_MS: "60000",
  WEBHOOK_REQUEST_TIMEOUT_MS: "5000",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
test.after(async () => {
  await pool.end();
});

test("BUG-079: queued retries are not sent while the endpoint is disabled, and resume when re-enabled", async () => {
  const merchantId = (
    await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
      `BUG-079 ${randomUUID()}`,
    ])
  ).rows[0]!.id;
  const url = `http://fake-receiver.test/bug-086-${randomUUID()}`;
  const endpoint = await createWebhookEndpoint(pool, config, {
    merchantId,
    url,
    createdByType: "merchant_session",
    createdById: randomUUID(),
  });
  await enqueueEvent(pool, {
    eventType: "transaction.captured",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: { merchantId, amountCapturedFils: 4_750, feeFils: 71, newStatus: "captured", capturedTotalFils: 4_750 },
  });

  let sends = 0;
  const transport = (statusCode: number): WebhookTransport => async (req) => {
    if (req.url === url) sends++;
    return { statusCode, body: "" };
  };
  const makeDue = () =>
    pool.query(`UPDATE webhook_deliveries SET next_attempt_at = now() - interval '1 second' WHERE endpoint_id = $1`, [
      endpoint.id,
    ]);

  // First attempt fails (receiver down) -> a retry is queued.
  await runDispatchPass(pool, transport(500), config);
  assert.equal(sends, 1);

  // Merchant pauses the endpoint; the retry comes due.
  await updateWebhookEndpoint(pool, config, { merchantId, id: endpoint.id, status: "disabled" });
  await makeDue();
  await runDispatchPass(pool, transport(200), config);
  assert.equal(sends, 1, "nothing is sent to a disabled endpoint");
  const paused = await pool.query<{ status: string }>(`SELECT status FROM webhook_deliveries WHERE endpoint_id = $1`, [
    endpoint.id,
  ]);
  assert.equal(paused.rows[0]!.status, "pending", "the retry waits, it is not burned");

  // Re-enabled: the waiting retry goes out.
  await updateWebhookEndpoint(pool, config, { merchantId, id: endpoint.id, status: "active" });
  await makeDue();
  await runDispatchPass(pool, transport(200), config);
  assert.equal(sends, 2);
});
