/**
 * BUG-007: the acquirer callback endpoint's signature is its only
 * authentication. It must always be required, be checked over the exact
 * bytes received, be fresh, and the body's outcome must be validated.
 * Requires DATABASE_URL to point at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("acquirerCallbacks.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const ACQUIRER_SECRET = "acqsec_route_new_test_secret";

// Note: ACQUIRER_CALLBACK_REQUIRE_SIGNATURE is NOT set, i.e. the old default.
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  ACQUIRER_CALLBACK_SIGNING_SECRET: ACQUIRER_SECRET,
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

async function createTransaction(): Promise<string> {
  const merchantResult = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, $2) RETURNING id`,
    [`Acquirer Callback Sig Merchant ${randomUUID()}`, 250],
  );
  const txnResult = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 50000, 50000, $2)
     RETURNING id`,
    [merchantResult.rows[0]!.id, `acqref_${randomUUID()}`],
  );
  return txnResult.rows[0]!.id;
}

function sign(raw: string, timestamp = Math.floor(Date.now() / 1000), secret = ACQUIRER_SECRET): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

async function noteCount(callbackId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM acquirer_callback_notes WHERE callback_id = $1`,
    [callbackId],
  );
  return Number(result.rows[0]!.count);
}

function body(transactionId: string, callbackId: string, outcome = "confirmed_fraud") {
  return {
    callbackId,
    type: "fraud_review.completed",
    transactionId,
    occurredAt: "2026-09-16T10:00:00.000Z",
    outcome,
    note: "Card testing pattern.",
  };
}

test("BUG-007: an unsigned callback is rejected even when ACQUIRER_CALLBACK_REQUIRE_SIGNATURE is unset", async () => {
  const callbackId = `acqcb_${randomUUID()}`;
  const res = await app.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    payload: body(await createTransaction(), callbackId),
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, "invalid_signature");
  assert.equal(await noteCount(callbackId), 0);
});

test("BUG-007: the signature is verified over the raw bytes the acquirer sent (pretty-printed / reordered JSON)", async () => {
  const callbackId = `acqcb_${randomUUID()}`;
  const b = body(await createTransaction(), callbackId);
  // The acquirer's serialiser: different key order and whitespace than JSON.stringify(parsed).
  const raw = JSON.stringify({ note: b.note, outcome: b.outcome, occurredAt: b.occurredAt, transactionId: b.transactionId, type: b.type, callbackId }, null, 2);
  const res = await app.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    headers: { "content-type": "application/json", "acquirer-callback-signature": sign(raw) },
    payload: raw,
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(await noteCount(callbackId), 1);
});

test("BUG-007: a correctly signed but stale callback (replay) is rejected", async () => {
  const callbackId = `acqcb_${randomUUID()}`;
  const raw = JSON.stringify(body(await createTransaction(), callbackId));
  const res = await app.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    headers: { "content-type": "application/json", "acquirer-callback-signature": sign(raw, 1_757_930_000) },
    payload: raw,
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().message, "timestamp_out_of_tolerance");
  assert.equal(await noteCount(callbackId), 0);
});

test("BUG-007: an outcome outside cleared|confirmed_fraud is a 400, not stored", async () => {
  const callbackId = `acqcb_${randomUUID()}`;
  const raw = JSON.stringify(body(await createTransaction(), callbackId, "approved"));
  const res = await app.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    headers: { "content-type": "application/json", "acquirer-callback-signature": sign(raw) },
    payload: raw,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(await noteCount(callbackId), 0);
});

test("BUG-007: a fresh, correctly signed callback is accepted", async () => {
  const callbackId = `acqcb_${randomUUID()}`;
  const raw = JSON.stringify(body(await createTransaction(), callbackId, "cleared"));
  const res = await app.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    headers: { "content-type": "application/json", "acquirer-callback-signature": sign(raw) },
    payload: raw,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(await noteCount(callbackId), 1);
});
