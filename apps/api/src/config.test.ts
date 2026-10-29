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
