/**
 * BUG-097: an expired link left 'reserved' by a payer who went away must
 * read and pay as expired. Real Postgres; requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { loadConfig } from "../config.js";
import { createAcquirerSimulator } from "../acquirer/simulator.js";
import { derivePublicStatus } from "./status.js";
import { getPublicPaymentLink } from "./read.js";
import { payPaymentLink } from "./pay.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("staleReservedExpired.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const acquirer = createAcquirerSimulator(config);

test.after(async () => {
  await pool.end();
});

test("BUG-097: derivePublicStatus — stale 'reserved' past expires_at -> 'expired'", () => {
  const status = derivePublicStatus(
    { status: "reserved", expiresAt: new Date(Date.now() - 60_000), reservedAt: new Date(Date.now() - 3_600_000) },
    60,
  );
  assert.equal(status, "expired");
});

test("BUG-097: stale reserved + expired link reads 'expired' and pay answers 410", async () => {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Stale Reserved ${randomUUID()}`],
  );
  const token = `plink_${randomUUID().replace(/-/g, "").slice(0, 22)}`;
  await pool.query(
    `INSERT INTO payment_links (merchant_id, token, amount_fils, expires_at, created_by_type, created_by_id, status, reserved_at)
     VALUES ($1, $2, 1000, now() - interval '1 minute', 'merchant_session', $3, 'reserved', now() - interval '1 hour')`,
    [m.rows[0]!.id, token, randomUUID()],
  );

  const read = await getPublicPaymentLink(pool, token, 60);
  assert.equal(read?.status, "expired"); // before: 'active' (checkout shows a Pay button)

  const pay = await payPaymentLink(pool, acquirer, { paymentLinkReservationTimeoutSeconds: 60 }, {
    token,
    card: { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" },
    idempotencyKey: randomUUID(),
  });
  assert.equal(pay.statusCode, 410, JSON.stringify(pay.body)); // before: 409 payment_link_processing
  assert.deepEqual(pay.body, { error: "payment_link_expired" });
});
