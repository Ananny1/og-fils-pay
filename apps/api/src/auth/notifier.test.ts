import assert from "node:assert/strict";
import { test } from "node:test";
import { sendOtpCode } from "./notifier.js";
import { sendAdminOtpCode } from "../adminAuth/notifier.js";

function stubLogger() {
  const lines: Array<Record<string, unknown>> = [];
  return { lines, logger: { info: (obj: Record<string, unknown>) => void lines.push(obj) } };
}

test("the merchant OTP code is not logged unless otpDevExpose is on", () => {
  const { lines, logger } = stubLogger();
  sendOtpCode(logger, { otpDevExpose: false }, { merchantUserId: "u1", email: "a@b.test" }, "123456");
  assert.equal(lines.length, 1);
  assert.equal(JSON.stringify(lines).includes("123456"), false);
});

test("the admin OTP code is not logged unless otpDevExpose is on", () => {
  const { lines, logger } = stubLogger();
  sendAdminOtpCode(logger, { otpDevExpose: false }, { adminUserId: "a1", email: "a@b.test" }, "654321");
  assert.equal(lines.length, 1);
  assert.equal(JSON.stringify(lines).includes("654321"), false);
});

test("with otpDevExpose on (local demo), the code is logged for the developer", () => {
  const { lines, logger } = stubLogger();
  sendOtpCode(logger, { otpDevExpose: true }, { merchantUserId: "u1", email: "a@b.test" }, "111222");
  assert.equal(JSON.stringify(lines).includes("111222"), true);
});
