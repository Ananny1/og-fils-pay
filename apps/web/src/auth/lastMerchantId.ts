/** The last-used merchant id, remembered so a returning user doesn't have to
 *  re-paste a UUID. It is not a credential (the password and OTP steps run
 *  unchanged), and signing out clears it. */
const LAST_MERCHANT_ID_KEY = "filspay.dashboard.lastMerchantId";

export function readLastMerchantId(): string {
  try {
    return window.localStorage.getItem(LAST_MERCHANT_ID_KEY) ?? "";
  } catch {
    // Private browsing / storage disabled — the field simply starts empty.
    return "";
  }
}

export function writeLastMerchantId(merchantId: string): void {
  try {
    window.localStorage.setItem(LAST_MERCHANT_ID_KEY, merchantId);
  } catch {
    // Nothing depends on this succeeding.
  }
}

/** Signing out forgets the merchant ID too, so the next person at a shared
 *  computer starts from an empty login form. */
export function clearLastMerchantId(): void {
  try {
    window.localStorage.removeItem(LAST_MERCHANT_ID_KEY);
  } catch {
    // Nothing depends on this succeeding.
  }
}
