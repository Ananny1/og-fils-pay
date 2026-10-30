/**
 * BUG-076: creating a payment link for 0 fils is a 400, never a 500.
 * Real, migrated Postgres. Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { BadRequestError } from "../lib/errors.js";
import { createPaymentLink } from "./create.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("createAmount.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

test.after(async () => {
  await pool.end();
});

test("BUG-076: a 0-fils payment link is rejected with 400 invalid_amount", async () => {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Link Amount ${randomUUID()}`],
  );
  // Before the fix: toFils(0) passed, the INSERT hit CHECK (amount_fils > 0)
  // and the route answered 500 internal_error.
  await assert.rejects(
    createPaymentLink(pool, { checkoutBaseUrl: "http://localhost" }, {
      merchantId: m.rows[0]!.id,
      amountFils: 0,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      createdByType: "merchant_session",
      createdById: randomUUID(),
    }),
    (err: unknown) => err instanceof BadRequestError && err.code === "invalid_amount",
  );
});
