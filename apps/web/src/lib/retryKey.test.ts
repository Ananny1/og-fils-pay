import { test } from "node:test";
import assert from "node:assert/strict";
import { createRetryKeys, isDefinitiveAnswer } from "./retryKey.js";

function counter() {
  let n = 0;
  return () => `key-${++n}`;
}

// BUG-093: a partial capture retried after a lost response must reuse its
// Idempotency-Key, or the server captures the amount a second time.
test("the same capture retried after a network failure reuses its key", () => {
  const keys = createRetryKeys(counter());
  const first = keys.keyFor("txn-1:2000");
  // fetch() threw (response lost) — not a definitive answer, nothing settled.
  assert.equal(keys.keyFor("txn-1:2000"), first);
});

test("after a definitive answer the next click is a new attempt", () => {
  const keys = createRetryKeys(counter());
  const first = keys.keyFor("txn-1:2000");
  keys.settle();
  assert.notEqual(keys.keyFor("txn-1:2000"), first);
});

test("a different amount or transaction is a different attempt", () => {
  const keys = createRetryKeys(counter());
  const first = keys.keyFor("txn-1:2000");
  assert.notEqual(keys.keyFor("txn-1:3000"), first);
  assert.notEqual(keys.keyFor("txn-2:3000"), keys.keyFor("txn-1:3000"));
});

test("only a non-5xx HTTP answer is definitive", () => {
  const http = (statusCode: number) => Object.assign(new Error("x"), { statusCode });
  assert.equal(isDefinitiveAnswer(http(402)), true);
  assert.equal(isDefinitiveAnswer(http(422)), true);
  assert.equal(isDefinitiveAnswer(http(409)), false); // request_in_progress: same key, try again
  assert.equal(isDefinitiveAnswer(http(500)), false);
  assert.equal(isDefinitiveAnswer(http(503)), false);
  assert.equal(isDefinitiveAnswer(new TypeError("Failed to fetch")), false);
});
