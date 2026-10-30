import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWholeFils } from "./filsInput.js";

// BUG-083: the "Adjust balance" box is in fils; Number() accepted BD-looking
// and exponent text and silently sent a different amount.
test("a plain whole number of fils is accepted, signed", () => {
  assert.equal(parseWholeFils("50000"), 50000);
  assert.equal(parseWholeFils(" -1250 "), -1250);
  assert.equal(parseWholeFils("+7"), 7);
});

test("BD-style text is refused, not read as fils", () => {
  // Number("50.000") === 50: a 50 BD correction would have posted 0.050 BD.
  assert.equal(parseWholeFils("50.000"), null);
  assert.equal(parseWholeFils("1.0"), null);
  assert.equal(parseWholeFils("1,000"), null);
});

test("exponent, hex and other Number() spellings are refused", () => {
  assert.equal(parseWholeFils("1e3"), null);
  assert.equal(parseWholeFils("0x10"), null);
  assert.equal(parseWholeFils("Infinity"), null);
  assert.equal(parseWholeFils(""), null);
  assert.equal(parseWholeFils("0"), null);
  assert.equal(parseWholeFils("-0"), null);
});

test("a value past the safe-integer range is refused", () => {
  assert.equal(parseWholeFils("9007199254740993"), null);
});
