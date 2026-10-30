import assert from "node:assert/strict";
import { test } from "node:test";
import { MAIL_THEME, sendOtpCode } from "./notifier.js";
import { sendAdminOtpCode } from "../adminAuth/notifier.js";
import type { OutgoingMail, SendMail } from "../lib/mail.js";

function stubLogger() {
  const lines: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];
  return {
    lines,
    errors,
    logger: {
      info: (obj: Record<string, unknown>) => void lines.push(obj),
      error: (obj: Record<string, unknown>) => void errors.push(obj),
    },
  };
}

/** No SMTP_HOST: today's behaviour, nothing is emailed. */
const NO_SMTP = {
  otpDevExpose: false,
  otpTtlMinutes: 5,
  adminOtpTtlMinutes: 5,
  nodeEnv: "test" as const,
  smtpHost: "",
  smtpPort: 1025,
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  mailFrom: "FilsPay <no-reply@filspay.local>",
};
const WITH_SMTP = { ...NO_SMTP, smtpHost: "mailpit" };

function fakeSend() {
  const sent: OutgoingMail[] = [];
  const send: SendMail = async (_config, mail) => void sent.push(mail);
  return { sent, send };
}

test("the merchant OTP code is not logged unless otpDevExpose is on", async () => {
  const { lines, logger } = stubLogger();
  await sendOtpCode(logger, NO_SMTP, { merchantUserId: "u1", email: "a@b.test" }, "123456");
  assert.equal(lines.length, 1);
  assert.equal(JSON.stringify(lines).includes("123456"), false);
});

test("the admin OTP code is not logged unless otpDevExpose is on", async () => {
  const { lines, logger } = stubLogger();
  await sendAdminOtpCode(logger, NO_SMTP, { adminUserId: "a1", email: "a@b.test" }, "654321");
  assert.equal(lines.length, 1);
  assert.equal(JSON.stringify(lines).includes("654321"), false);
});

test("with otpDevExpose on (local demo), the code is logged for the developer", async () => {
  const { lines, logger } = stubLogger();
  await sendOtpCode(logger, { ...NO_SMTP, otpDevExpose: true }, { merchantUserId: "u1", email: "a@b.test" }, "111222");
  assert.equal(JSON.stringify(lines).includes("111222"), true);
});

test("without SMTP_HOST nothing is emailed (ENH-001)", async () => {
  const { logger } = stubLogger();
  const { sent, send } = fakeSend();
  await sendOtpCode(logger, NO_SMTP, { merchantUserId: "u1", email: "a@b.test" }, "123456", send);
  await sendAdminOtpCode(logger, NO_SMTP, { adminUserId: "a1", email: "a@b.test" }, "654321", send);
  assert.equal(sent.length, 0);
});

test("with SMTP set, the merchant code is emailed once to the user and not logged (ENH-001)", async () => {
  const { lines, errors, logger } = stubLogger();
  const { sent, send } = fakeSend();
  await sendOtpCode(logger, WITH_SMTP, { merchantUserId: "u1", email: "owner@shop.test" }, "482913", send);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, "owner@shop.test");
  assert.match(sent[0]!.text, /482913/);
  assert.match(sent[0]!.text, /5 minutes/);
  assert.equal(JSON.stringify([...lines, ...errors]).includes("482913"), false);
});

test("with SMTP set, the admin code is emailed once to the admin and not logged (ENH-001)", async () => {
  const { lines, errors, logger } = stubLogger();
  const { sent, send } = fakeSend();
  await sendAdminOtpCode(logger, WITH_SMTP, { adminUserId: "a1", email: "staff@filspay.test" }, "907261", send);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, "staff@filspay.test");
  assert.match(sent[0]!.text, /907261/);
  assert.equal(JSON.stringify([...lines, ...errors]).includes("907261"), false);
});

test("a failing SMTP send is logged (without the code), not thrown (ENH-001)", async () => {
  const { errors, logger } = stubLogger();
  const failing: SendMail = async () => {
    throw new Error("connect ECONNREFUSED");
  };
  await sendOtpCode(logger, WITH_SMTP, { merchantUserId: "u1", email: "a@b.test" }, "135790", failing);
  await sendAdminOtpCode(logger, WITH_SMTP, { adminUserId: "a1", email: "a@b.test" }, "135790", failing);
  assert.equal(errors.length, 2);
  assert.equal(JSON.stringify(errors).includes("135790"), false);
});

test("the code email has a simple HTML version: code, validity, warning, no external content", async () => {
  const { logger } = stubLogger();
  const { sent, send } = fakeSend();
  await sendOtpCode(logger, WITH_SMTP, { merchantUserId: "u1", email: "owner@shop.test" }, "482913", send);
  await sendAdminOtpCode(logger, WITH_SMTP, { adminUserId: "a1", email: "staff@filspay.test" }, "907261", send);
  for (const [mail, code] of [[sent[0]!, "482913"], [sent[1]!, "907261"]] as const) {
    assert.ok(mail.html, "an HTML part is sent");
    assert.match(mail.html!, new RegExp(code));
    assert.match(mail.html!, /minutes/);
    assert.match(mail.html!, /wasn.t you/);
    assert.match(mail.html!, new RegExp(MAIL_THEME.accent));
    assert.doesNotMatch(mail.html!, /<img|src=|https?:\/\//, "no images, scripts or links");
  }
  assert.match(sent[1]!.html!, /staff console/);
});
