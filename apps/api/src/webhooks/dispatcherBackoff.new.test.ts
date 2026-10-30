/**
 * BUG-052: the webhook retry schedule must be the documented exact
 * exponential schedule; jitter is opt-in and never exceeds the cap.
 * Pure function, no database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffDelayMs } from "./dispatcher.js";

test("BUG-052: backoffDelayMs follows the documented exponential schedule exactly (no jitter by default)", () => {
  const cfg = { webhookBackoffBaseMs: 1000, webhookBackoffCapMs: 60_000 };
  for (let i = 0; i < 20; i++) {
    assert.equal(backoffDelayMs(1, cfg), 1000);
    assert.equal(backoffDelayMs(2, cfg), 2000);
    assert.equal(backoffDelayMs(3, cfg), 4000);
    assert.equal(backoffDelayMs(10, cfg), 60_000);
  }
});

test("BUG-052: opt-in jitter never exceeds the configured cap", () => {
  const cfg = { webhookBackoffBaseMs: 1000, webhookBackoffCapMs: 60_000 };
  assert.ok(backoffDelayMs(10, cfg, () => 0.999) <= 60_000);
  assert.ok(backoffDelayMs(1, cfg, () => 0) >= 900);
});
