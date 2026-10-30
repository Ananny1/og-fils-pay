import assert from "node:assert/strict";
import test from "node:test";
import { keyForNextAttempt } from "./refundIdempotency.js";

test("after a lost answer (network error) the retry reuses the key, so it can't refund twice", () => {
  assert.equal(keyForNextAttempt("k1", false), "k1");
});

test("after the server answered (success or a decline) the next refund gets a fresh key", () => {
  assert.equal(keyForNextAttempt("k1", true), null);
});
