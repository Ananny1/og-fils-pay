import assert from "node:assert/strict";
import test from "node:test";
import { bahrainBusinessDate, businessDayHasEnded, businessDayStart } from "./businessDay.js";

test("a business day starts at Bahrain midnight = 21:00 UTC the day before", () => {
  assert.equal(businessDayStart("2026-10-30").toISOString(), "2026-10-29T21:00:00.000Z");
});

test("the Bahrain date flips at 21:00 UTC, not at UTC midnight", () => {
  assert.equal(bahrainBusinessDate(new Date("2026-10-30T20:59:59Z")), "2026-10-30");
  assert.equal(bahrainBusinessDate(new Date("2026-10-30T21:00:00Z")), "2026-10-31");
});

test("30 Oct is over only from Bahrain midnight (21:00 UTC on 30 Oct)", () => {
  assert.equal(businessDayHasEnded("2026-10-30", new Date("2026-10-30T16:49:00Z")), false); // 19:49 Bahrain
  assert.equal(businessDayHasEnded("2026-10-30", new Date("2026-10-30T20:59:59Z")), false);
  assert.equal(businessDayHasEnded("2026-10-30", new Date("2026-10-30T21:00:00Z")), true);
  assert.equal(businessDayHasEnded("2026-10-31", new Date("2026-10-30T21:00:00Z")), false);
});
