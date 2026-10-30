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

test("production refuses secrets that are public: the leaked acquirer secret, dev values, placeholders (SEC-4)", () => {
  const good = {
    DATABASE_URL,
    NODE_ENV: "production",
    SETTLEMENT_INTERNAL_TOKEN: "a-real-random-token",
    ACQUIRER_CALLBACK_SIGNING_SECRET: "a-real-random-secret",
    WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  };
  assert.doesNotThrow(() => loadConfig(good));

  const known: Array<[string, string]> = [
    // committed in ops/.env.docker (669af52, reference history): leaked, must be rotated
    ["ACQUIRER_CALLBACK_SIGNING_SECRET", "acqsec_sandbox_f8c3a1e6b9d24f7081c5e3a9b7d4f602"],
    ["ACQUIRER_CALLBACK_SIGNING_SECRET", "dev-only-acquirer-secret-not-for-production"],
    ["ACQUIRER_CALLBACK_SIGNING_SECRET", "change-me"],
    ["SETTLEMENT_INTERNAL_TOKEN", "dev-only-settlement-token-not-for-production"],
    ["SETTLEMENT_INTERNAL_TOKEN", "change-me"],
    ["WEBHOOK_SECRET_ENCRYPTION_KEY", "ZGV2LW9ubHktd2ViaG9vay1rZXktbm90LWZvci1wcmQ="],
    ["KYC_ENCRYPTION_KEY", "ZGV2LW9ubHktd2ViaG9vay1rZXktbm90LWZvci1wcmQ="],
  ];
  for (const [name, value] of known) {
    assert.throws(() => loadConfig({ ...good, [name]: value }), new RegExp(`${name} .*publicly known`), name);
  }
  // Dev and test keep working with the dev values.
  assert.doesNotThrow(() =>
    loadConfig({ DATABASE_URL, NODE_ENV: "development", ACQUIRER_CALLBACK_SIGNING_SECRET: "change-me" }),
  );
});

test("KYC_ENCRYPTION_KEY falls back to the webhook key, and a malformed one refuses to boot (SEC-4)", () => {
  const webhookKey = "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=";
  assert.equal(loadConfig({ DATABASE_URL, WEBHOOK_SECRET_ENCRYPTION_KEY: webhookKey }).kycEncryptionKey, webhookKey);
  const kycKey = Buffer.alloc(32, 7).toString("base64");
  assert.equal(loadConfig({ DATABASE_URL, KYC_ENCRYPTION_KEY: kycKey }).kycEncryptionKey, kycKey);
  assert.throws(
    () => loadConfig({ DATABASE_URL, KYC_ENCRYPTION_KEY: "dG9vLXNob3J0" }),
    /KYC_ENCRYPTION_KEY must base64-decode/,
  );
});
