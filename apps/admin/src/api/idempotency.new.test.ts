import assert from "node:assert/strict";
import { test } from "node:test";
import { keyForNextAttempt } from "./idempotency.js";

test("BUG-109: the server answered (success or an error status) → a new key for the next action", () => {
  assert.equal(keyForNextAttempt("k1", true), null);
});

test("BUG-109: no answer (network error) → keep the key so a retry cannot post twice", () => {
  assert.equal(keyForNextAttempt("k1", false), "k1");
});
