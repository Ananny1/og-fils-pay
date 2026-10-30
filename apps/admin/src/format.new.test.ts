import { test } from "node:test";
import assert from "node:assert/strict";
import { bahrainInputToIso, bahrainInputValue, bahrainToday } from "./format.js";

// BUG-091: the credit form's default effective date came from the browser's
// own calendar, not Bahrain's.
test("00:30 in Bahrain is already the new Bahrain day (21:30 UTC the evening before)", () => {
  assert.equal(bahrainToday(new Date("2026-10-29T21:30:00Z")), "2026-10-30");
});

test("20:59 UTC is still the same Bahrain day", () => {
  assert.equal(bahrainToday(new Date("2026-10-30T20:59:59Z")), "2026-10-30");
});

test("21:00 UTC is midnight in Bahrain: the next day", () => {
  assert.equal(bahrainToday(new Date("2026-10-30T21:00:00Z")), "2026-10-31");
});

// BUG-092: the webhook replay window was read in the browser's zone while the
// console shows every delivery time in Bahrain time.
test("a typed replay time is read as Bahrain time", () => {
  assert.equal(bahrainInputToIso("2026-10-30T18:00"), "2026-10-30T15:00:00.000Z");
  assert.equal(bahrainInputToIso("2026-10-30T00:00:00"), "2026-10-29T21:00:00.000Z");
  assert.equal(bahrainInputToIso(""), null);
  assert.equal(bahrainInputToIso("not a date"), null);
});

test("the default replay window is filled in Bahrain wall time", () => {
  assert.equal(bahrainInputValue(new Date("2026-10-30T15:00:00Z")), "2026-10-30T18:00");
  assert.equal(bahrainInputValue(new Date("2026-10-30T21:30:00Z")), "2026-10-31T00:30");
});
