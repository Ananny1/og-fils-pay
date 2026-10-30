import assert from "node:assert/strict";
import test from "node:test";
import { formatCardBrandHint, formatCardNumberInput, isValidCardNumber } from "./helpers.js";

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

test("UX-90: only 16-digit card numbers are accepted", () => {
  assert.equal(isValidCardNumber("4222222222222"), false); // 13-digit Visa, Luhn-valid
  assert.equal(isValidCardNumber("4242424242424242424"), false); // 19 digits
  assert.equal(isValidCardNumber("4242424242424242"), true);
});

test("UX-90: the card field shows groups of four and stops at 16 digits", () => {
  assert.equal(formatCardNumberInput(""), "");
  assert.equal(formatCardNumberInput("4242"), "4242");
  assert.equal(formatCardNumberInput("42424"), "4242 4");
  assert.equal(formatCardNumberInput("4242424242424242"), "4242 4242 4242 4242");
  assert.equal(formatCardNumberInput("4242 4242 4242 4242 999"), "4242 4242 4242 4242"); // extra digits dropped
  assert.equal(formatCardNumberInput("42a4-2b4"), "4242 4"); // letters and dashes dropped
});
