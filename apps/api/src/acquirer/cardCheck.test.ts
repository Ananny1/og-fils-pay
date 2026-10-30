import assert from "node:assert/strict";
import { test } from "node:test";
import { cardBrand, checkCard, luhnOk } from "./cardCheck.js";

const NOW = new Date("2026-10-30T12:00:00Z");
const ok = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

test("known test cards pass, including the simulator's decline cards", () => {
  for (const pan of ["4242424242424242", "4111111111111111", "4000000000000002", "4000000000000119", "4000000000000069", "5555555555554444", "2223003122003222", "4242 4242 4242 4242"]) {
    assert.equal(checkCard({ ...ok, pan }, NOW), null, pan);
  }
});

test("one wrong digit fails the Luhn check", () => {
  assert.equal(luhnOk("4111111111111111"), true);
  assert.equal(checkCard({ ...ok, pan: "4111111111111112" }, NOW), "invalid_card_number");
});

test("wrong length for the network is refused", () => {
  assert.equal(checkCard({ ...ok, pan: "4" }, NOW), "invalid_card_number");
  assert.equal(checkCard({ ...ok, pan: "42424242424242" }, NOW), "invalid_card_number");
  assert.equal(checkCard({ ...ok, pan: "abcd" }, NOW), "invalid_card_number");
});

test("Mastercard 2-series range is 2221 to 2720 inclusive", () => {
  assert.equal(cardBrand("2220990000000000"), null);
  assert.equal(cardBrand("2221000000000000"), "mastercard");
  assert.equal(cardBrand("2720990000000000"), "mastercard");
  assert.equal(cardBrand("2721000000000000"), null);
});

test("only Visa and Mastercard are accepted", () => {
  assert.equal(checkCard({ ...ok, pan: "378282246310005" }, NOW), "unsupported_card_brand"); // Amex
  assert.equal(checkCard({ ...ok, pan: "6011111111111117" }, NOW), "unsupported_card_brand"); // Discover
});

test("expiry: bad month refused, past month refused, current month still good (Bahrain time)", () => {
  assert.equal(checkCard({ ...ok, expiryMonth: 13 }, NOW), "invalid_expiry");
  assert.equal(checkCard({ ...ok, expiryMonth: 9, expiryYear: 2026 }, NOW), "card_expired");
  assert.equal(checkCard({ ...ok, expiryMonth: 10, expiryYear: 2026 }, NOW), null);
  // 31 Oct 22:00 UTC is already 1 Nov in Bahrain: an October card has expired.
  assert.equal(checkCard({ ...ok, expiryMonth: 10, expiryYear: 2026 }, new Date("2026-10-31T22:00:00Z")), "card_expired");
});

test("CVV must be three digits", () => {
  assert.equal(checkCard({ ...ok, cvv: "12" }, NOW), "invalid_cvv");
  assert.equal(checkCard({ ...ok, cvv: "12a" }, NOW), "invalid_cvv");
});
