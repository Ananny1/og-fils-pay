import assert from "node:assert/strict";
import test from "node:test";
import { formatCardBrandHint, isValidCardNumber } from "./helpers.js";

test("BUG-063: Mastercard 2-series is 2221 to 2720 inclusive", () => {
  assert.equal(formatCardBrandHint("2220990000000000"), "unknown");
  assert.equal(formatCardBrandHint("2221000000000000"), "mastercard");
  assert.equal(formatCardBrandHint("2720990000000000"), "mastercard");
  assert.equal(formatCardBrandHint("2721000000000000"), "unknown");
  assert.equal(formatCardBrandHint("3782 822463 10005"), "unknown"); // Amex is not taken
});

test("BUG-063: card number needs a Visa/Mastercard prefix, the right length and a correct Luhn digit", () => {
  for (const pan of ["4242 4242 4242 4242", "4000000000000002", "5555555555554444", "2223003122003222"]) {
    assert.equal(isValidCardNumber(pan), true, pan);
  }
  assert.equal(isValidCardNumber("4242424242424241"), false); // one digit wrong
  assert.equal(isValidCardNumber("4"), false);
  assert.equal(isValidCardNumber("378282246310005"), false);
  assert.equal(isValidCardNumber("4242-4242-4242-424x"), false);
});
