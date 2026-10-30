/**
 * BUG-075: when the checkout's capture step fails, the payer's authorization
 * must not stay open. Real, migrated Postgres. Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { toFils } from "@filspay/money";
import { loadConfig } from "../config.js";
import { recordKycReview } from "../onboarding/review.js";
import { createAcquirerSimulator } from "../acquirer/simulator.js";
import type { AcquirerSimulator } from "../acquirer/types.js";
import { payPaymentLink } from "./pay.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("payCaptureFailure.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
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
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const simulator = createAcquirerSimulator(config);

test.after(async () => {
  await pool.end();
});

const APPROVED_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

/** Approves every authorization; answers the first capture with `firstCapture`, then approves. */
function acquirerFailingFirstCapture(firstCapture: "declined" | "error"): AcquirerSimulator {
  let captures = 0;
  return {
    ...simulator,
    async capture(req) {
      captures += 1;
      if (captures === 1) return { outcome: firstCapture, acquirerReference: req.acquirerReference, latencyMs: 0 };
      return simulator.capture(req);
    },
  };
}

async function createLink(amountFils: number) {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Pay Capture Failure ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const token = `plink_${randomUUID().replace(/-/g, "").slice(0, 22)}`;
  await pool.query(
    `INSERT INTO payment_links (merchant_id, token, amount_fils, expires_at, created_by_type, created_by_id)
     VALUES ($1, $2, $3, now() + interval '1 hour', 'merchant_session', $4)`,
    [merchantId, token, toFils(amountFils), randomUUID()],
  );
  return { merchantId, token };
}

for (const outcome of ["declined", "error"] as const) {
  test(`BUG-075: capture ${outcome} at checkout voids the authorization; the retry is the only open sale`, async () => {
    const acquirer = acquirerFailingFirstCapture(outcome);
    const { merchantId, token } = await createLink(4_750);
    const cfg = { paymentLinkReservationTimeoutSeconds: 60 };

    const first = await payPaymentLink(pool, acquirer, cfg, { token, card: APPROVED_CARD, idempotencyKey: randomUUID() });
    assert.equal(first.statusCode, outcome === "declined" ? 402 : 502, JSON.stringify(first.body));

    // The web checkout sends a fresh key per click.
    const second = await payPaymentLink(pool, acquirer, cfg, { token, card: APPROVED_CARD, idempotencyKey: randomUUID() });
    assert.equal(second.statusCode, 200, JSON.stringify(second.body));

    const txns = await pool.query<{ status: string }>(
      `SELECT status FROM transactions WHERE merchant_id = $1 ORDER BY created_at`,
      [merchantId],
    );
    // Before the fix: ['authorized', 'captured'] — the first sale stayed open
    // (capturable by the merchant, a second charge) with a 7-day card hold.
    assert.deepEqual(
      txns.rows.map((r) => r.status),
      ["voided", "captured"],
    );
    const holds = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM holds WHERE merchant_id = $1 AND status = 'active'`,
      [merchantId],
    );
    assert.equal(holds.rows[0]!.n, 0);
  });
}
