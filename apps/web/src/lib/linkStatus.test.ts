import { test } from "node:test";
import assert from "node:assert/strict";
import { linkDisplayStatus } from "./linkStatus.js";

const NOW = new Date("2026-10-30T18:00:00Z");

// BUG-181: links are never stored as 'expired' (the API derives it only on
// the public checkout), so the dashboard showed a past-expiry link as "active".
test("an active link past its expiry shows as expired", () => {
  assert.equal(linkDisplayStatus({ status: "active", expiresAt: "2026-10-30T17:59:59Z" }, NOW), "expired");
});

test("an active link before its expiry stays active", () => {
  assert.equal(linkDisplayStatus({ status: "active", expiresAt: "2026-10-31T00:00:00Z" }, NOW), "active");
});

test("paid and canceled keep their own status even after expiry", () => {
  assert.equal(linkDisplayStatus({ status: "paid", expiresAt: "2026-10-01T00:00:00Z" }, NOW), "paid");
  assert.equal(linkDisplayStatus({ status: "canceled", expiresAt: "2026-10-01T00:00:00Z" }, NOW), "canceled");
});
