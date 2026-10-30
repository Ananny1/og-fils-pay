/**
 * The raw OTP must never leave the server (response body or logs) unless a
 * developer explicitly opts in with OTP_DEV_EXPOSE=true. A missing NODE_ENV
 * (the hosted compose box) is not an opt-in.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import { sendOtpCode } from "./notifier.js";
import { sendAdminOtpCode } from "../adminAuth/notifier.js";

const BASE_ENV = {
  DATABASE_URL: "postgres://unused/unused",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  SETTLEMENT_INTERNAL_TOKEN: "t",
  ACQUIRER_CALLBACK_SIGNING_SECRET: "s",
};

function capture() {
  const lines: Array<Record<string, unknown>> = [];
  return { lines, logger: { info: (obj: Record<string, unknown>) => void lines.push(obj) } };
}

test("BUG-031: OTP is not exposed by default, whatever NODE_ENV is", () => {
  for (const NODE_ENV of [undefined, "development", "test", "production"]) {
    const config = loadConfig({ ...BASE_ENV, ...(NODE_ENV ? { NODE_ENV } : {}) });
    assert.equal(config.otpDevExpose, false, `NODE_ENV=${NODE_ENV ?? "(unset)"} exposed the OTP`);
  }
  assert.equal(loadConfig({ ...BASE_ENV, OTP_DEV_EXPOSE: "true" }).otpDevExpose, true, "explicit dev opt-in");
});

test("BUG-031: the OTP code is not logged unless OTP_DEV_EXPOSE is on", () => {
  const config = loadConfig({ ...BASE_ENV }); // NODE_ENV unset -> 'development'
  const merchant = capture();
  sendOtpCode(merchant.logger, config, { merchantUserId: "u1", email: "a@b.test" }, "123456");
  assert.ok(!("code" in merchant.lines[0]!), "merchant OTP code written to the log");

  const admin = capture();
  sendAdminOtpCode(admin.logger, config, { adminUserId: "a1", email: "a@b.test" }, "654321");
  assert.ok(!("code" in admin.lines[0]!), "admin OTP code written to the log");

  const devConfig = loadConfig({ ...BASE_ENV, OTP_DEV_EXPOSE: "true" });
  const dev = capture();
  sendOtpCode(dev.logger, devConfig, { merchantUserId: "u1", email: "a@b.test" }, "123456");
  assert.equal(dev.lines[0]!.code, "123456", "dev opt-in still logs the code");
});
