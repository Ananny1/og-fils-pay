/**
 * HOST-2: a hosted (NODE_ENV=production) seed must not create users with the
 * passwords committed in generate.ts. No database needed.
 *   npx tsx --test db/seed/seedPasswords.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SEED_ADMIN_PASSWORD, SEED_USER_PASSWORD, seedPasswords } from "./generate.js";

test("dev and CI keep the committed seed passwords", () => {
  assert.deepEqual(seedPasswords({}), { user: SEED_USER_PASSWORD, admin: SEED_ADMIN_PASSWORD });
  assert.deepEqual(seedPasswords({ NODE_ENV: "test" }), { user: SEED_USER_PASSWORD, admin: SEED_ADMIN_PASSWORD });
});

test("production takes both passwords from env", () => {
  const env = { NODE_ENV: "production", SEED_USER_PASSWORD: "shop-pass-1234", SEED_ADMIN_PASSWORD: "staff-pass-5678" };
  assert.deepEqual(seedPasswords(env), { user: "shop-pass-1234", admin: "staff-pass-5678" });
});

test("production refuses missing, committed, short or shared passwords", () => {
  const ok = { NODE_ENV: "production", SEED_USER_PASSWORD: "shop-pass-1234", SEED_ADMIN_PASSWORD: "staff-pass-5678" };
  assert.throws(() => seedPasswords({ NODE_ENV: "production" }), /SEED_USER_PASSWORD/);
  assert.throws(() => seedPasswords({ ...ok, SEED_ADMIN_PASSWORD: undefined }), /SEED_ADMIN_PASSWORD/);
  assert.throws(() => seedPasswords({ ...ok, SEED_USER_PASSWORD: SEED_USER_PASSWORD }), /SEED_USER_PASSWORD/);
  assert.throws(() => seedPasswords({ ...ok, SEED_ADMIN_PASSWORD: SEED_ADMIN_PASSWORD }), /SEED_ADMIN_PASSWORD/);
  assert.throws(() => seedPasswords({ ...ok, SEED_USER_PASSWORD: "short" }), /SEED_USER_PASSWORD/);
  assert.throws(() => seedPasswords({ ...ok, SEED_ADMIN_PASSWORD: ok.SEED_USER_PASSWORD }), /must differ/);
});
