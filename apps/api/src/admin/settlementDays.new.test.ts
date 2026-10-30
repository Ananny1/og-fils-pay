import assert from "node:assert/strict";
import test from "node:test";
import { dayStatus } from "./settlementDays.js";

test("today is 'running' whatever it holds", () => {
  assert.equal(dayStatus({ ended: false, waitingFils: 5000, batchCount: 0, paidBatchCount: 0 }), "running");
});

test("an ended day with unclaimed sales needs closing, even if some shops were closed", () => {
  assert.equal(dayStatus({ ended: true, waitingFils: 1, batchCount: 3, paidBatchCount: 3 }), "needs_closing");
});

test("closed but not all paid", () => {
  assert.equal(dayStatus({ ended: true, waitingFils: 0, batchCount: 3, paidBatchCount: 2 }), "closed_unpaid");
});

test("nothing waiting and every batch paid (or no sales at all) is done", () => {
  assert.equal(dayStatus({ ended: true, waitingFils: 0, batchCount: 3, paidBatchCount: 3 }), "done");
  assert.equal(dayStatus({ ended: true, waitingFils: 0, batchCount: 0, paidBatchCount: 0 }), "done");
});
