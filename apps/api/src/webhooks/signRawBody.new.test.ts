/**
 * BUG-023: a merchant verifies a webhook the standard way — HMAC-SHA256 over
 * `${t}.${raw request body}` with their secret. The signature must match the
 * exact bytes sent, both for real deliveries and for "send test event".
 * The HMAC here is computed independently of sign.ts on purpose.
 * Requires DATABASE_URL to point at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { enqueueEvent } from "@filspay/events";
import { loadConfig } from "../config.js";
import { createWebhookEndpoint } from "./create.js";
import { runDispatchPass } from "./dispatcher.js";
import { sendTestWebhookEvent } from "./testSend.js";
import { WEBHOOK_SIGNATURE_HEADER } from "./headers.js";
import type { WebhookTransport, WebhookTransportRequest } from "./transport.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("signRawBody.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  WEBHOOK_REQUEST_TIMEOUT_MS: "5000",
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });

test.after(async () => {
  await pool.end();
});

/** What a merchant's receiver does: HMAC the raw bytes, compare to v1. */
function merchantVerifies(rawBody: string, header: string, secret: string): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(`${match[1]}.${rawBody}`).digest("hex");
  return expected === match[2];
}

async function setup(label: string) {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Raw Sign Merchant ${label} ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const url = `http://fake-receiver.test/raw-${randomUUID()}`;
  const endpoint = await createWebhookEndpoint(pool, config, {
    merchantId,
    url,
    createdByType: "merchant_session",
    createdById: randomUUID(),
  });
  const captured: WebhookTransportRequest[] = [];
  const transport: WebhookTransport = async (req) => {
    if (req.url === url) captured.push(req);
    return { statusCode: 200, body: "ok" };
  };
  return { merchantId, endpoint, captured, transport };
}

test("BUG-023: a dispatched webhook's signature verifies over the raw body bytes that were sent", async () => {
  const { merchantId, endpoint, captured, transport } = await setup("dispatch");
  await enqueueEvent(pool, {
    eventType: "transaction.captured",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: { merchantId, amountCapturedFils: 4_750, feeFils: 71, newStatus: "captured", capturedTotalFils: 4_750 },
  });

  await runDispatchPass(pool, transport, config);

  assert.equal(captured.length, 1);
  const req = captured[0]!;
  assert.ok(merchantVerifies(req.body, req.headers[WEBHOOK_SIGNATURE_HEADER]!, endpoint.secret));
});

test("BUG-023: a test-send's signature verifies over the raw body bytes that were sent", async () => {
  const { merchantId, endpoint, captured, transport } = await setup("test-send");

  await sendTestWebhookEvent(pool, config, transport, { merchantId, endpointId: endpoint.id });

  assert.equal(captured.length, 1);
  const req = captured[0]!;
  assert.ok(merchantVerifies(req.body, req.headers[WEBHOOK_SIGNATURE_HEADER]!, endpoint.secret));
});
