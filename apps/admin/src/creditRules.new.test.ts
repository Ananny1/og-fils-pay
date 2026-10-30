import { test } from "node:test";
import assert from "node:assert/strict";
import { canApproveCredit } from "./creditRules.js";

const item = { status: "pending_approval" as const, requestedByAdminUserId: "admin-a" };

// BUG-100: the requester was offered "Approve" on their own credit, which the
// server always refuses (409 self_approval_forbidden).
test("the operator who raised a credit is not offered Approve", () => {
  assert.equal(canApproveCredit(item, "admin-a"), false);
});

test("a different operator is offered Approve on a pending credit", () => {
  assert.equal(canApproveCredit(item, "admin-b"), true);
});

test("nothing to approve once decided", () => {
  assert.equal(canApproveCredit({ ...item, status: "posted" }, "admin-b"), false);
});
