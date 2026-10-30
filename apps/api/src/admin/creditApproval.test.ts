import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { assertDistinctApprover } from "./creditApproval.js";
import { AppError } from "../lib/errors.js";

test("an operator cannot approve their own credit request", () => {
  const actor = { adminUserId: randomUUID(), displayName: "Dana Finance" };
  assert.throws(
    () => assertDistinctApprover(actor, actor),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, "self_approval_forbidden");
      return true;
    },
  );
});

// BUG-013: the check is by admin user id (HANDOVER "Credits"), not by display name.
test("the same operator under a different display name is still a self-approval", () => {
  const id = randomUUID();
  assert.throws(
    () => assertDistinctApprover({ adminUserId: id, displayName: "Dana Finance" }, { adminUserId: id, displayName: "D. F." }),
    (err: unknown) => err instanceof AppError && err.code === "self_approval_forbidden",
  );
});

test("two different operators who share a display name may approve each other", () => {
  assert.doesNotThrow(() =>
    assertDistinctApprover(
      { adminUserId: randomUUID(), displayName: "Ali Hasan" },
      { adminUserId: randomUUID(), displayName: "Ali Hasan" },
    ),
  );
});

test("two different operators satisfy two-person control", () => {
  assert.doesNotThrow(() =>
    assertDistinctApprover(
      { adminUserId: randomUUID(), displayName: "Dana Finance" },
      { adminUserId: randomUUID(), displayName: "Omar Treasury" },
    ),
  );
});
