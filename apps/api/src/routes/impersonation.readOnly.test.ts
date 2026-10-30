/**
 * BUG-010: "view as merchant" is support-level and read-only for every admin
 * role (HANDOVER), not owner for a super_admin, and it can't reach write
 * routes that have no role gate (capture, void, saved filters).
 * Real migrated Postgres (DATABASE_URL).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { lookupImpersonationGrant, startImpersonation } from "../admin/impersonation.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("impersonation.readOnly.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const kycUploadDir = mkdtempSync(join(tmpdir(), "filspay-kyc-test-"));
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  KYC_UPLOAD_DIR: kycUploadDir,
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
  await rm(kycUploadDir, { recursive: true, force: true });
});

type AdminRole = "support" | "finance" | "super_admin";

async function createMerchant(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `Imp ${randomUUID().slice(0, 8)}`,
        registrationNumber: `RC-${randomUUID().slice(0, 8)}`,
        businessType: "llc",
        contactEmail: `contact-${randomUUID()}@example.test`,
        contactPhone: "+97300000000",
        addressLine1: "1 Test Street",
        city: "Manama",
      },
      owner: { email: `imp-${randomUUID()}@example.test`, password: "imp-test-password-1!" },
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { merchantId: string }).merchantId;
}

async function grantFor(role: AdminRole) {
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, 'x', 'Imp', $2) RETURNING id`,
    [`imp-${randomUUID()}@admin.test`, role],
  );
  const merchantId = await createMerchant();
  const started = await startImpersonation(pool, { adminUserId: admin.rows[0]!.id, merchantId, ttlMinutes: 10 });
  return { adminUserId: admin.rows[0]!.id, merchantId, rawToken: started.rawToken, cookie: `${config.impersonationCookieName}=${started.rawToken}` };
}

for (const role of ["support", "finance", "super_admin"] as const) {
  test(`a ${role} impersonation grant resolves to the read-only support role`, async () => {
    const { rawToken } = await grantFor(role);
    const grant = await lookupImpersonationGrant(pool, rawToken);
    assert.equal(grant?.merchantRole, "support");
  });

  test(`a ${role} impersonation grant cannot write, even on routes without a role gate`, async () => {
    const { merchantId, cookie } = await grantFor(role);

    const read = await app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie } });
    assert.equal(read.statusCode, 200, read.body);

    const writes = [
      { method: "POST" as const, url: `/v1/merchants/${merchantId}/payment-links`,
        payload: { amountFils: 1000, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } },
      { method: "POST" as const, url: `/v1/transactions/${randomUUID()}/capture`, payload: {} },
      { method: "POST" as const, url: `/v1/transactions/${randomUUID()}/void`, payload: {} },
      { method: "POST" as const, url: "/v1/reporting/saved-filters", payload: { name: "imp", filter: {} } },
    ];
    for (const w of writes) {
      const res = await app.inject({ ...w, headers: { cookie, "idempotency-key": randomUUID() } });
      assert.equal(res.statusCode, 403, `${w.method} ${w.url}: ${res.body}`);
    }

    const links = await pool.query(`SELECT 1 FROM payment_links WHERE merchant_id = $1`, [merchantId]);
    assert.equal(links.rowCount, 0);
    const filters = await pool.query(`SELECT 1 FROM reporting_saved_filters WHERE merchant_id = $1`, [merchantId]);
    assert.equal(filters.rowCount, 0);
  });
}

// SEC-RT-1: disabling an admin must kill their live "view as merchant" grant
// on the next request, the same way it kills their admin session.
test("a disabled admin's impersonation grant no longer resolves or reads merchant data", async () => {
  const { adminUserId, rawToken, cookie } = await grantFor("support");
  assert.ok(await lookupImpersonationGrant(pool, rawToken), "live grant resolves before the disable");

  await pool.query(`UPDATE admin_users SET status = 'disabled' WHERE id = $1`, [adminUserId]);

  assert.equal(await lookupImpersonationGrant(pool, rawToken), null);
  const read = await app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie } });
  assert.equal(read.statusCode, 401, read.body);
});
