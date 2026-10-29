import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPIRE_HOLDS_SQL, expireHolds } from "./expire_holds.js";

test("expiring holds is a status flip, never a delete", () => {
  assert.match(EXPIRE_HOLDS_SQL, /^UPDATE holds SET status = 'expired'/);
  assert.doesNotMatch(EXPIRE_HOLDS_SQL, /DELETE/i);
});

test("the update is always scoped to active holds past expires_at", () => {
  assert.match(EXPIRE_HOLDS_SQL, /WHERE status = 'active' AND expires_at < now\(\)$/);
});

test("expireHolds runs the one statement and reports the row count", async () => {
  const seen: string[] = [];
  const client = {
    query: async (text: string) => {
      seen.push(text);
      return { rowCount: 3 };
    },
  } as unknown as Parameters<typeof expireHolds>[0];
  assert.equal(await expireHolds(client), 3);
  assert.deepEqual(seen, [EXPIRE_HOLDS_SQL]);
});
