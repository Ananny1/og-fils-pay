/**
 * Two-person control on credits must compare WHO the operators are (admin
 * user ids), not what they are called (display names, which are mutable and
 * not unique). Real Postgres via DATABASE_URL for the end-to-end case.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { assertDistinctApprover } from "./creditApproval.js";
import { approveCreditRequest, createCreditRequest } from "./credits.js";
import { AppError } from "../lib/errors.js";

test("BUG-013: the same operator under a different display name is still self-approval", () => {
  const id = randomUUID();
  assert.throws(
    () => assertDistinctApprover({ adminUserId: id, displayName: "Dana Finance" }, { adminUserId: id, displayName: "D. F." }),
    (err: unknown) => err instanceof AppError && err.code === "self_approval_forbidden",
  );
});

test("BUG-013: two different operators who share a display name may approve each other", () => {
  assert.doesNotThrow(() =>
    assertDistinctApprover(
      { adminUserId: randomUUID(), displayName: "Ali Hasan" },
      { adminUserId: randomUUID(), displayName: "Ali Hasan" },
    ),
  );
});

test("BUG-013: an admin who renames themselves cannot approve their own credit", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("requires DATABASE_URL");
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, display_name, role)
       VALUES ($1, 'unused', 'Maker Name', 'finance') RETURNING id`,
      [`maker-${randomUUID()}@admin.test`],
    );
    const adminUserId = admin.rows[0]!.id;
    const merchant = await pool.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
      [`Credit Self ${randomUUID()}`],
    );

    const request = await createCreditRequest(pool, {
      merchantId: merchant.rows[0]!.id,
      adminUserId,
      body: { baseAmountFils: 120_000, reasonCode: "goodwill", effectiveDate: new Date().toISOString().slice(0, 10) },
    });
    assert.equal(request.status, "pending_approval");

    await pool.query(`UPDATE admin_users SET display_name = 'Checker Name' WHERE id = $1`, [adminUserId]);

    await assert.rejects(
      approveCreditRequest(pool, {
        creditRequestId: request.id,
        approver: { adminUserId, displayName: "Checker Name" },
      }),
      (err: unknown) => err instanceof AppError && err.code === "self_approval_forbidden",
    );
    const row = await pool.query<{ status: string }>(`SELECT status FROM credit_requests WHERE id = $1`, [request.id]);
    assert.equal(row.rows[0]!.status, "pending_approval");
  } finally {
    await pool.end();
  }
});
