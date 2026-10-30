import assert from "node:assert/strict";
import test from "node:test";
import { fieldMessage, type CheckedField } from "./formCheck.js";

const ok: CheckedField["validity"] = {
  valueMissing: false,
  typeMismatch: false,
  patternMismatch: false,
  tooShort: false,
  tooLong: false,
  rangeUnderflow: false,
  rangeOverflow: false,
  stepMismatch: false,
  badInput: false,
};

test("UX-71: a valid field has no message", () => {
  assert.equal(fieldMessage({ label: "Email", type: "email", validity: ok }), null);
});

test("UX-71: required, bad email and pattern give in-app messages that name the field", () => {
  assert.equal(fieldMessage({ label: "Email", type: "email", validity: { ...ok, valueMissing: true } }), "Email is required.");
  assert.match(fieldMessage({ label: "Email", type: "email", validity: { ...ok, typeMismatch: true } })!, /^Email: enter a valid email address/);
  assert.equal(
    fieldMessage({ label: "Month", type: "text", title: "Month, 01 to 12", validity: { ...ok, patternMismatch: true } }),
    "Month: Month, 01 to 12",
  );
  assert.equal(fieldMessage({ label: "Role", type: "select-one", validity: { ...ok, valueMissing: true } }), "Choose Role.");
  assert.equal(fieldMessage({ label: "Amount", type: "number", min: "1", validity: { ...ok, rangeUnderflow: true } }), "Amount must be 1 or more.");
});

test("UX-71: checkout messages come in Arabic too", () => {
  assert.equal(fieldMessage({ label: "رمز التحقق", type: "text", validity: { ...ok, valueMissing: true } }, "ar"), "رمز التحقق: هذا الحقل مطلوب.");
});
