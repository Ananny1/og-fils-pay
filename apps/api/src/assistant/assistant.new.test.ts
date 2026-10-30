/**
 * The dashboard assistant must never leak another merchant's data and must
 * never be reachable without a merchant session. These tests do not call
 * Claude. Requires DATABASE_URL (a real, migrated Postgres).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { runAssistantTool } from "./tools.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("assistant.new.test.ts requires DATABASE_URL");

const pool = new Pool({ connectionString: databaseUrl, max: 3 });
after(async () => {
  await pool.end();
});

async function merchantWithTxn(label: string): Promise<{ merchantId: string; reference: string }> {
  const m = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 225) RETURNING id`, [
    `assistant test ${label} ${randomUUID()}`,
  ]);
  const merchantId = m.rows[0]!.id;
  const reference = `asst-${label}-${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, reference, acquirer_reference)
     VALUES ($1, 'captured', 4755, 4755, $2, $3)`,
    [merchantId, reference, `acq_${randomUUID()}`],
  );
  return { merchantId, reference };
}

test("list_transactions only returns the session merchant's rows, with BD strings formatted from integer fils", async () => {
  const a = await merchantWithTxn("a");
  const b = await merchantWithTxn("b");

  const out = JSON.parse(
    await runAssistantTool(
      "list_transactions",
      { status: [], from: null, to: null, search: null, limit: 50 },
      { pool, merchantId: a.merchantId, role: "owner" },
    ),
  ) as { transactions: Array<{ reference: string; capturedBhd: string; capturedFils: number }> };

  const refs = out.transactions.map((t) => t.reference);
  assert.ok(refs.includes(a.reference), "own transaction is visible");
  assert.ok(!refs.includes(b.reference), "another merchant's transaction is never visible");
  const own = out.transactions.find((t) => t.reference === a.reference)!;
  assert.equal(own.capturedFils, 4755);
  assert.equal(own.capturedBhd, "4.755 BHD");
});

test("a search for another merchant's reference finds nothing", async () => {
  const a = await merchantWithTxn("c");
  const b = await merchantWithTxn("d");
  const out = JSON.parse(
    await runAssistantTool(
      "list_transactions",
      { status: [], from: null, to: null, search: b.reference, limit: 10 },
      { pool, merchantId: a.merchantId, role: "owner" },
    ),
  ) as { count: number };
  assert.equal(out.count, 0);
});

test("get_reconciliation is refused for a support user (same gate as the reconciliation route)", async () => {
  const a = await merchantWithTxn("e");
  await assert.rejects(
    runAssistantTool("get_reconciliation", { from: "2026-10-01", to: "2026-11-01" }, { pool, merchantId: a.merchantId, role: "support" }),
    /owner and finance/,
  );
});

test("POST /v1/assistant/chat without a merchant session is 401", async () => {
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  });
  const app = buildApp(config, pool);
  const res = await app.inject({
    method: "POST",
    url: "/v1/assistant/chat",
    payload: { messages: [{ role: "user", content: "hi" }] },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});
