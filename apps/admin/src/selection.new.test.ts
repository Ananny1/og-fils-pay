import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleSelection } from "./selection.js";

// BUG-094: merchants ticked under an earlier search/filter stayed selected
// after the table changed, and "Approve KYC" sent them too, unseen.
test("only ticked rows that are still on screen are acted on", () => {
  const selected = new Set(["a", "b", "c"]);
  const rows = [{ id: "c" }, { id: "d" }];
  assert.deepEqual(visibleSelection(selected, rows), ["c"]);
});

test("nothing ticked on screen means nothing is sent", () => {
  assert.deepEqual(visibleSelection(new Set(["a"]), [{ id: "b" }]), []);
});
