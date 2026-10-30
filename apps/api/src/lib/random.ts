import { randomInt } from "node:crypto";

/** Generates a string of `n` random decimal digits (e.g. "042817"), from a
 *  CSPRNG: these are OTP codes (BUG-011). */
export function randomDigits(n: number): string {
  const max = 10 ** n;
  return randomInt(max)
    .toString()
    .padStart(n, "0");
}

/** Generates a string of `n` characters drawn uniformly from `alphabet`, from
 *  a CSPRNG: payment-link tokens and admin invite codes are bearer secrets. */
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
