import type { SimulatedCardInput } from "./types.js";

/**
 * Card checks done before any acquirer call (BUG-063). FilsPay takes Visa
 * and Mastercard only. A number is accepted when its prefix names one of
 * them, its length fits that network, and its Luhn check digit is right;
 * the expiry must be a real month that has not ended (Bahrain time, UTC+3)
 * and the CVV three digits. Anything else is a typo or garbage and never
 * reaches the acquirer.
 */
export type CardBrand = "visa" | "mastercard";

export type CardProblem = "invalid_card_number" | "unsupported_card_brand" | "invalid_expiry" | "card_expired" | "invalid_cvv";

const BAHRAIN_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Visa: starts with 4. Mastercard: 51-55, or 2221-2720 (checked on four digits). */
export function cardBrand(pan: string): CardBrand | null {
  if (/^4/.test(pan)) return "visa";
  if (/^5[1-5]/.test(pan)) return "mastercard";
  const first4 = Number(pan.slice(0, 4));
  if (pan.length >= 4 && first4 >= 2221 && first4 <= 2720) return "mastercard";
  return null;
}

/** Luhn (mod 10): double every second digit from the right, the total must end in 0. */
export function luhnOk(pan: string): boolean {
  let total = 0;
  for (let i = pan.length - 1, double = false; i >= 0; i--, double = !double) {
    let digit = pan.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
  }
  return total % 10 === 0;
}

const LENGTHS: Record<CardBrand, readonly number[]> = { visa: [13, 16, 19], mastercard: [16] };

export function checkCard(card: SimulatedCardInput, now: Date = new Date()): CardProblem | null {
  const pan = typeof card.pan === "string" ? card.pan.replace(/[\s-]/g, "") : "";
  if (!/^\d+$/.test(pan)) return "invalid_card_number";
  const brand = cardBrand(pan);
  if (!brand) return "unsupported_card_brand";
  if (!LENGTHS[brand].includes(pan.length) || !luhnOk(pan)) return "invalid_card_number";

  const { expiryMonth, expiryYear } = card;
  if (!Number.isInteger(expiryMonth) || expiryMonth < 1 || expiryMonth > 12) return "invalid_expiry";
  if (!Number.isInteger(expiryYear) || expiryYear < 2000 || expiryYear > 2100) return "invalid_expiry";
  // A card is good to the last day of its expiry month.
  const bahrainNow = new Date(now.getTime() + BAHRAIN_OFFSET_MS);
  if (expiryYear * 12 + expiryMonth < bahrainNow.getUTCFullYear() * 12 + bahrainNow.getUTCMonth() + 1) {
    return "card_expired";
  }

  if (typeof card.cvv !== "string" || !/^\d{3}$/.test(card.cvv)) return "invalid_cvv";
  return null;
}
