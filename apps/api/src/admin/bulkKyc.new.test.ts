/**
 * Bulk KYC approval must only move merchants that are waiting for review
 * (`under_review`), and must leave the same per-merchant review trail as a
 * single review. Real Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { bulkApproveMerchantsKyc } from "./bulkKyc.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("bulkKyc.new.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

test.after(async () => {
  await pool.end();
});

async function merchantIn(status: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, onboarding_status, kyc_passed)
     VALUES ($1, 250, $2, false) RETURNING id`,
    [`Bulk KYC ${status} ${randomUUID()}`, status],
  );
  return r.rows[0]!.id;
}

test("BUG-033: bulk approve only approves under_review merchants and writes a review row for each", async () => {
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role)
     VALUES ($1, 'unused', 'Bulk Approver', 'finance') RETURNING id`,
    [`bulk-${randomUUID()}@admin.test`],
  );
  const waiting = await merchantIn("under_review");
  const rejected = await merchantIn("rejected");
  const noDocs = await merchantIn("submitted");

  const result = await bulkApproveMerchantsKyc(pool, {
    merchantIds: [waiting, rejected, noDocs],
    adminUserId: admin.rows[0]!.id,
  });

  assert.deepEqual(result.approvedMerchantIds, [waiting]);
  assert.equal(result.approvedCount, 1);

  const rows = await pool.query<{ id: string; onboarding_status: string; kyc_passed: boolean }>(
    `SELECT id, onboarding_status, kyc_passed FROM merchants WHERE id = ANY($1)`,
    [[waiting, rejected, noDocs]],
  );
  const byId = new Map(rows.rows.map((r) => [r.id, r]));
  assert.equal(byId.get(waiting)!.onboarding_status, "approved");
  assert.equal(byId.get(rejected)!.onboarding_status, "rejected", "a rejected merchant was approved in bulk");
  assert.equal(byId.get(rejected)!.kyc_passed, false);
  assert.equal(byId.get(noDocs)!.onboarding_status, "submitted", "a merchant with no KYC documents was approved");
  assert.equal(byId.get(noDocs)!.kyc_passed, false);

  const reviews = await pool.query<{ merchant_id: string; outcome: string; reviewer_admin_user_id: string }>(
    `SELECT merchant_id, outcome, reviewer_admin_user_id FROM merchant_kyc_reviews WHERE merchant_id = ANY($1)`,
    [[waiting, rejected, noDocs]],
  );
  assert.equal(reviews.rowCount, 1, "one merchant_kyc_reviews row per approved merchant");
  assert.equal(reviews.rows[0]!.merchant_id, waiting);
  assert.equal(reviews.rows[0]!.outcome, "approved");
  assert.equal(reviews.rows[0]!.reviewer_admin_user_id, admin.rows[0]!.id);
});
