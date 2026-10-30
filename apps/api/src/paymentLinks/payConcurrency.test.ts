/**
 * BUG-005: a payment link must never be charged twice, even when the
 * acquirer is slower than the reservation timeout (incident 2026-05-14).
 * Real, migrated Postgres; a wrapped simulator makes capture slow.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { toFils } from "@filspay/money";
import { loadConfig } from "../config.js";
import { createAcquirerSimulator } from "../acquirer/simulator.js";
import type { AcquirerSimulator } from "../acquirer/types.js";
import { recordKycReview } from "../onboarding/review.js";
import { payPaymentLink } from "./pay.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("payConcurrency.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  PAYMENT_LINK_RESERVATION_TIMEOUT_SECONDS: "1",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 10 });
test.after(async () => {
  await pool.end();
});

const APPROVED_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Real simulator, but every capture takes `captureDelayMs` (longer than the 1 s reservation timeout). */
function slowCaptureAcquirer(captureDelayMs: number): AcquirerSimulator {
  const inner = createAcquirerSimulator(config);
  return {
    authorize: (req) => inner.authorize(req),
    capture: async (req) => {
      await sleep(captureDelayMs);
      return inner.capture(req);
    },
    refund: (req) => inner.refund(req),
  };
}

async function createActiveLink(amountFils: number) {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Test Merchant paylink-race ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const token = `plink_test_${randomUUID()}`;
  await pool.query(
    `INSERT INTO payment_links (merchant_id, token, amount_fils, expires_at, created_by_type, created_by_id)
     VALUES ($1, $2, $3, now() + interval '1 hour', 'merchant_api_key', gen_random_uuid())`,
    [merchantId, token, toFils(amountFils)],
  );
  return { merchantId, token };
}

test("slow capture past the reservation timeout + a second payer -> exactly one charge", async () => {
  const { merchantId, token } = await createActiveLink(2_500);
  const acquirer = slowCaptureAcquirer(2_500);
  const cfg = { paymentLinkReservationTimeoutSeconds: config.paymentLinkReservationTimeoutSeconds };

  const first = payPaymentLink(pool, acquirer, cfg, { token, card: APPROVED_CARD, idempotencyKey: randomUUID() });
  // Second payer arrives after the first one's reservation has gone stale.
  await sleep(1_500);
  const second = payPaymentLink(pool, acquirer, cfg, { token, card: APPROVED_CARD, idempotencyKey: randomUUID() });

  const results = await Promise.all([first, second]);
  const ok = results.filter((r) => r.statusCode === 200);
  assert.equal(ok.length, 1, `exactly one payer is told "paid": ${JSON.stringify(results)}`);

  const captured = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM transactions WHERE merchant_id = $1 AND captured_fils > 0`,
    [merchantId],
  );
  assert.equal(captured.rows[0]!.c, 1, "the card was captured exactly once");

  const link = await pool.query<{ status: string; transaction_id: string }>(
    `SELECT status, transaction_id FROM payment_links WHERE token = $1`,
    [token],
  );
  assert.equal(link.rows[0]!.status, "paid");
  assert.equal(link.rows[0]!.transaction_id, (ok[0]!.body as { transactionId: string }).transactionId);
});

/** Same shape as the API's own pool (PG_POOL_MAX 5 default); short connection timeout so a starved pool fails fast. */
function apiSizedPool() {
  return new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 2_000 });
}

test("pool-size (5) concurrent checkouts on 5 different links all succeed (no pool starvation)", async () => {
  const smallPool = apiSizedPool();
  try {
    const links = await Promise.all([1, 2, 3, 4, 5].map(() => createActiveLink(1_000)));
    const acquirer = slowCaptureAcquirer(300);
    const cfg = { paymentLinkReservationTimeoutSeconds: 60 };

    const results = await Promise.allSettled(
      links.map(({ token }) =>
        payPaymentLink(smallPool, acquirer, cfg, { token, card: APPROVED_CARD, idempotencyKey: randomUUID() }),
      ),
    );
    const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.statusCode : `threw: ${String(r.reason)}`));
    assert.deepEqual(statuses, [200, 200, 200, 200, 200]);
  } finally {
    await smallPool.end();
  }
});

test("5 parallel payers on the SAME link -> one charge, the others get 409 fast", async () => {
  const smallPool = apiSizedPool();
  try {
    const { merchantId, token } = await createActiveLink(1_000);
    const acquirer = slowCaptureAcquirer(1_500);
    const cfg = { paymentLinkReservationTimeoutSeconds: 60 };

    const timed = async () => {
      const started = Date.now();
      const result = await payPaymentLink(smallPool, acquirer, cfg, {
        token,
        card: APPROVED_CARD,
        idempotencyKey: randomUUID(),
      });
      return { result, ms: Date.now() - started };
    };
    const runs = await Promise.allSettled([timed(), timed(), timed(), timed(), timed()]);
    const done = runs.map((r) => {
      assert.equal(r.status, "fulfilled", `no payer may throw (pool timeout): ${String((r as PromiseRejectedResult).reason)}`);
      return (r as PromiseFulfilledResult<{ result: { statusCode: number; body: unknown }; ms: number }>).value;
    });

    const ok = done.filter((d) => d.result.statusCode === 200);
    const rejected = done.filter((d) => d.result.statusCode === 409);
    assert.equal(ok.length, 1, `exactly one payer is told "paid": ${JSON.stringify(done)}`);
    assert.equal(rejected.length, 4, `the others get 409: ${JSON.stringify(done)}`);
    for (const r of rejected) {
      assert.ok(r.ms < 1_000, `a losing payer is answered at once, not after waiting (${r.ms} ms)`);
    }

    const captured = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM transactions WHERE merchant_id = $1 AND captured_fils > 0`,
      [merchantId],
    );
    assert.equal(captured.rows[0]!.c, 1, "the card was captured exactly once");
  } finally {
    await smallPool.end();
  }
});

test("a captured payment whose finalize was lost never makes the link payable again", async () => {
  const { merchantId, token } = await createActiveLink(1_000);
  const acquirer = createAcquirerSimulator(config);
  const cfg = { paymentLinkReservationTimeoutSeconds: 1 };

  const first = await payPaymentLink(pool, acquirer, cfg, { token, card: APPROVED_CARD, idempotencyKey: randomUUID() });
  assert.equal(first.statusCode, 200);

  // Simulate: capture committed, then the finalize UPDATE failed (DB blip /
  // crash), so the link is still 'reserved' with no transaction, long stale.
  await pool.query(
    `UPDATE payment_links
        SET status = 'reserved', transaction_id = NULL, paid_at = NULL, reserved_at = now() - interval '1 hour'
      WHERE token = $1`,
    [token],
  );

  const second = await payPaymentLink(pool, acquirer, cfg, { token, card: APPROVED_CARD, idempotencyKey: randomUUID() });
  assert.notEqual(second.statusCode, 200, `the link must not be charged again: ${JSON.stringify(second)}`);

  const captured = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM transactions WHERE merchant_id = $1 AND captured_fils > 0`,
    [merchantId],
  );
  assert.equal(captured.rows[0]!.c, 1, "the card was captured exactly once");
});
