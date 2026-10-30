/**
 * OTP codes and payment-link tokens are secrets: they must come from the OS
 * CSPRNG (node:crypto), never from Math.random, whose output is predictable
 * (V8's xorshift128+ state can be recovered from a few outputs).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomDigits, randomFromAlphabet } from "./random.js";
import { generateOtpCode } from "../auth/otp.js";
import { generateInviteCode } from "../admin/inviteCode.js";

function withFrozenMathRandom(fn: () => void): void {
  const original = Math.random;
  Math.random = () => 0.5;
  try {
    fn();
  } finally {
    Math.random = original;
  }
}

test("BUG-011: OTP digits do not come from Math.random", () => {
  withFrozenMathRandom(() => {
    const codes = new Set(Array.from({ length: 20 }, () => generateOtpCode(6)));
    assert.ok(codes.size > 1, `every OTP was ${[...codes][0]} once Math.random was frozen`);
    for (const code of codes) assert.match(code, /^\d{6}$/);
    const digits = new Set(Array.from({ length: 20 }, () => randomDigits(6)));
    assert.ok(digits.size > 1);
  });
});

test("BUG-011: alphabet tokens (payment-link tokens) and invite codes do not come from Math.random", () => {
  withFrozenMathRandom(() => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const tokens = new Set(Array.from({ length: 20 }, () => randomFromAlphabet(alphabet, 22)));
    assert.ok(tokens.size > 1, "every token was identical once Math.random was frozen");
    for (const t of tokens) {
      assert.equal(t.length, 22);
      for (const ch of t) assert.ok(alphabet.includes(ch));
    }
    const invites = new Set(Array.from({ length: 20 }, () => generateInviteCode()));
    assert.ok(invites.size > 1, "every invite code was identical once Math.random was frozen");
  });
});
