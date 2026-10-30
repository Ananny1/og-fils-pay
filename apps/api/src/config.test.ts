import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.js";

const DATABASE_URL = "postgres://filspay:filspay@localhost:5432/filspay_test";

test("development boots without WEBHOOK_SECRET_ENCRYPTION_KEY, using a valid 32-byte dev key", () => {
  const config = loadConfig({ DATABASE_URL, NODE_ENV: "development" });
  assert.equal(Buffer.from(config.webhookSecretEncryptionKey, "base64").length, 32);
});

test("an unset NODE_ENV is development and also boots without a key", () => {
  const config = loadConfig({ DATABASE_URL });
  assert.equal(config.nodeEnv, "development");
  assert.equal(Buffer.from(config.webhookSecretEncryptionKey, "base64").length, 32);
});

test("production still refuses to boot without a real key", () => {
  assert.throws(
    () =>
      loadConfig({
        DATABASE_URL,
        NODE_ENV: "production",
        SETTLEMENT_INTERNAL_TOKEN: "t",
        ACQUIRER_CALLBACK_SIGNING_SECRET: "s",
      }),
    /WEBHOOK_SECRET_ENCRYPTION_KEY environment variable is not set/,
  );
});

test("the OTP is never exposed unless OTP_DEV_EXPOSE is set explicitly", () => {
  for (const NODE_ENV of [undefined, "development", "test"]) {
    assert.equal(loadConfig({ DATABASE_URL, NODE_ENV }).otpDevExpose, false, `NODE_ENV=${NODE_ENV}`);
  }
  assert.equal(loadConfig({ DATABASE_URL, NODE_ENV: "development", OTP_DEV_EXPOSE: "true" }).otpDevExpose, true);
});

test("production refuses to boot with OTP_DEV_EXPOSE turned on", () => {
  assert.throws(
    () =>
      loadConfig({
        DATABASE_URL,
        NODE_ENV: "production",
        OTP_DEV_EXPOSE: "true",
        SETTLEMENT_INTERNAL_TOKEN: "t",
        ACQUIRER_CALLBACK_SIGNING_SECRET: "s",
        WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
      }),
    /OTP_DEV_EXPOSE/,
  );
});

test("SMTP is off unless SMTP_HOST is set, and its settings are read when it is (ENH-001)", () => {
  assert.equal(loadConfig({ DATABASE_URL }).smtpHost, "");
  const config = loadConfig({
    DATABASE_URL,
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "sender@example.test",
    MAIL_FROM: "FilsPay <sender@example.test>",
  });
  assert.equal(config.smtpHost, "smtp.gmail.com");
  assert.equal(config.smtpPort, 465);
  assert.equal(config.smtpSecure, true);
  assert.equal(config.smtpUser, "sender@example.test");
  assert.equal(config.mailFrom, "FilsPay <sender@example.test>");
});
