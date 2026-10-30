/**
 * ENH-009: the dashboard assistant calls a paid AI service. Without a limit,
 * any logged-in shop (or an API-key script) could send thousands of questions
 * and run up the bill. Per-merchant minute and day budgets, kept in Postgres
 * so they hold across API instances. Real migrated Postgres (DATABASE_URL).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { TooManyRequestsError } from "../lib/errors.js";
import { reserveAssistantCall } from "./usageLimit.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("usageLimit.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const pool = new Pool({ connectionString: databaseUrl, max: 3 });

test.after(async () => {
  await pool.end();
});

async function createMerchant(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Assistant ${randomUUID()}`],
  );
  return result.rows[0]!.id;
}

test("the call over the per-minute budget is refused with 429 + Retry-After; another shop is unaffected", async () => {
  const merchant = await createMerchant();
  const other = await createMerchant();
  const limits = { perMinute: 6, perDay: 100 };
  for (let i = 0; i < 6; i += 1) await reserveAssistantCall(pool, merchant, limits);
  await assert.rejects(reserveAssistantCall(pool, merchant, limits), (err: unknown) => {
    assert.ok(err instanceof TooManyRequestsError);
    assert.equal(err.code, "assistant_rate_limited");
    assert.ok((err.retryAfterSeconds ?? 0) >= 1);
    return true;
  });
  await reserveAssistantCall(pool, other, limits);
});

test("parallel calls cannot slip past the budget", async () => {
  const merchant = await createMerchant();
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, () => reserveAssistantCall(pool, merchant, { perMinute: 6, perDay: 100 })),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 6);
});

test("the daily budget holds even when each minute is under its limit", async () => {
  const merchant = await createMerchant();
  await pool.query(
    `INSERT INTO assistant_usage (merchant_id, created_at)
     SELECT $1, now() - make_interval(mins => g) FROM generate_series(2, 11) g`,
    [merchant],
  );
  await assert.rejects(reserveAssistantCall(pool, merchant, { perMinute: 6, perDay: 10 }), TooManyRequestsError);
});

test("the chat route refuses before calling the AI service once the budget is spent", async () => {
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
    ANTHROPIC_API_KEY: "test-key-never-sent",
    ASSISTANT_PER_MINUTE: "0",
  });
  const app = buildApp(config, pool);
  try {
    const merchantId = await createMerchant();
    const u = await pool.query<{ id: string }>(
      `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
      [merchantId, `owner-${randomUUID()}@example.test`],
    );
    await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
    const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label: "assistant" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/assistant/chat",
      headers: { authorization: `Bearer ${rawKey}` },
      payload: { messages: [{ role: "user", content: "hello" }] },
    });
    assert.equal(res.statusCode, 429, res.body);
    assert.equal(res.json().error, "assistant_rate_limited");
    assert.ok(res.headers["retry-after"]);
  } finally {
    await app.close();
  }
});
