/**
 * BUG-051 / BUG-053: dispatcher reliability.
 * Requires DATABASE_URL to point at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { enqueueEvent } from "@filspay/events";
import { loadConfig } from "../config.js";
import { createWebhookEndpoint } from "./create.js";
import { runDispatchPass } from "./dispatcher.js";
import type { WebhookTransport } from "./transport.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("dispatcher.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  WEBHOOK_MAX_ATTEMPTS: "3",
  WEBHOOK_BACKOFF_BASE_MS: "1000",
  WEBHOOK_BACKOFF_CAP_MS: "60000",
  WEBHOOK_REQUEST_TIMEOUT_MS: "5000",
});

const pool = new Pool({ connectionString: databaseUrl, max: 10 });

test.after(async () => {
  await pool.end();
});

async function createMerchantWithEndpoint(label: string) {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Dispatcher New Test ${label} ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const url = `http://fake-receiver.test/${label}-${randomUUID()}`;
  const endpoint = await createWebhookEndpoint(pool, config, {
    merchantId,
    url,
    createdByType: "merchant_session",
    createdById: randomUUID(),
  });
  return { merchantId, url, endpoint };
}

async function enqueueCaptured(merchantId: string) {
  return enqueueEvent(pool, {
    eventType: "transaction.captured",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: { merchantId, amountCapturedFils: 4_750, feeFils: 71, newStatus: "captured", capturedTotalFils: 4_750 },
  });
}

test("BUG-051: two dispatchers (two API replicas) running at once send each delivery exactly once", async () => {
  const { merchantId, url } = await createMerchantWithEndpoint("replicas");
  await enqueueCaptured(merchantId);

  let sends = 0;
  const slowTransport: WebhookTransport = async (req) => {
    if (req.url === url) sends++;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { statusCode: 200, body: "ok" };
  };

  // Create the row first so both passes race purely on Step B.
  await runDispatchPass(pool, async () => ({ statusCode: null, body: "", errorMessage: "warmup" }), {
    ...config,
    webhookMaxAttempts: 99,
  });
  await pool.query(
    `UPDATE webhook_deliveries wd SET next_attempt_at = now() - interval '1 second', attempt_count = 0
       FROM webhook_endpoints we
      WHERE we.id = wd.endpoint_id AND we.url = $1`,
    [url],
  );
  sends = 0;

  await Promise.all([
    runDispatchPass(pool, slowTransport, config),
    runDispatchPass(pool, slowTransport, config),
  ]);

  assert.equal(sends, 1);
});

test("BUG-053: a delivery whose endpoint secret cannot be decrypted is marked failed, not retried forever", async () => {
  const { merchantId, url, endpoint } = await createMerchantWithEndpoint("undecryptable");
  const outboxEvent = await enqueueCaptured(merchantId);
  await pool.query(`UPDATE webhook_endpoints SET secret_ciphertext = $1 WHERE id = $2`, [
    Buffer.from("too-short").toString("base64"),
    endpoint.id,
  ]);

  let sends = 0;
  const transport: WebhookTransport = async (req) => {
    if (req.url === url) sends++;
    return { statusCode: 200, body: "ok" };
  };
  await runDispatchPass(pool, transport, config);

  const row = await pool.query<{ status: string; response_body_excerpt: string | null }>(
    `SELECT status, response_body_excerpt FROM webhook_deliveries
      WHERE outbox_event_id = $1 AND endpoint_id = $2`,
    [String(outboxEvent.id), endpoint.id],
  );
  assert.equal(row.rows[0]!.status, "failed");
  assert.match(row.rows[0]!.response_body_excerpt ?? "", /secret/);
  assert.equal(sends, 0);
});
