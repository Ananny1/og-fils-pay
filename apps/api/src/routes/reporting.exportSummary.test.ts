/**
 * SEC-RT-3: GET /v1/reporting/export-summary had no auth preHandler, unlike
 * every other reporting route. Unauthenticated callers got a 500 (the
 * handler dereferenced a missing merchantAuth). Real migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("reporting.exportSummary.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

async function merchantWithKey(): Promise<{ merchantId: string; rawKey: string }> {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Export Summary ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused-in-these-tests') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label: "es" });
  return { merchantId, rawKey: issued.rawKey };
}

test("export-summary without credentials is 401, not a 500", async () => {
  const res = await app.inject({ method: "GET", url: "/v1/reporting/export-summary" });
  assert.equal(res.statusCode, 401, res.body);
});

test("export-summary with credentials returns only the caller's own totals", async () => {
  const a = await merchantWithKey();
  const b = await merchantWithKey();
  await pool.query(
    `INSERT INTO merchant_daily_volume (merchant_id, volume_date, captured_count, captured_gross_fils, voided_count, refund_count, refund_gross_fils)
     VALUES ($1, '2026-01-01', 1, 1500, 0, 1, 500), ($1, '2026-01-02', 1, 2500, 0, 0, 0), ($2, '2026-01-01', 1, 99000, 0, 0, 0)`,
    [a.merchantId, b.merchantId],
  );

  const res = await app.inject({
    method: "GET",
    url: "/v1/reporting/export-summary",
    headers: { authorization: `Bearer ${a.rawKey}` },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json(), { totalDays: 2, grossFils: 4000, refundedFils: 500, netFils: 3500 });
});
