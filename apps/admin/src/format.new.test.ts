import { test } from "node:test";
import assert from "node:assert/strict";
import { bahrainToday } from "./format.js";

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
