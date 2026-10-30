import { randomInt } from "node:crypto";

/**
 * Both helpers draw from the OS CSPRNG (`crypto.randomInt`), never
 * `Math.random`: their outputs are secrets (OTP codes, payment-link tokens),
 * and Math.random's state can be recovered from a handful of outputs.
 */

/** Generates a string of `n` random decimal digits (e.g. "042817"). */
export function randomDigits(n: number): string {
  const max = 10 ** n;
  return randomInt(0, max)
    .toString()
    .padStart(n, "0");
}

/** Generates a string of `n` characters drawn uniformly from `alphabet`. */
export function randomFromAlphabet(alphabet: string, n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += alphabet[randomInt(alphabet.length)];
  }
  return out;
}

/** Short display-only reference for receipts and logs (e.g. "FP-A7K2M3"). */
export function displayReference(): string {
  return `FP-${randomFromAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6)}`;
}
