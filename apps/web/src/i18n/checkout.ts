import { formatBhd, toFils } from "@filspay/money";
import { dateTime } from "../format.js";

/**
 * ENH-011 — every customer-facing string on the public checkout (/pay/:token)
 * in English and Arabic, plus the bilingual lines the merchant's scan-to-pay
 * card shows. One typed dictionary: a key missing from either language is a
 * compile error, and `i18n/checkout.test.ts` checks it again at runtime.
 *
 * Number convention (both languages): Western digits 0-9 and a "." decimal
 * point, always 3 decimals (1 BD = 1000 fils). Bahraini cards, receipts and
 * bank SMS print amounts this way, and a card number or amount must never
 * change shape when the customer flips the language. Only the currency label
 * moves: "BD 4.750" in English, "4.750 د.ب" in Arabic.
 */

export type CheckoutLang = "en" | "ar";

export const CHECKOUT_LANGS: readonly CheckoutLang[] = ["en", "ar"];

/** Why a payment attempt did not go through — rendered via `messages`. */
export type CheckoutMessageKey =
  | "declined"
  | "captureFailed"
  | "acquirerUnavailable"
  | "inProgress"
  | "alreadyPaid"
  | "canceled"
  | "expired"
  | "invalidCardNumber"
  | "incompleteCardNumber"
  | "unsupportedCard"
  | "invalidExpiry"
  | "cardExpired"
  | "invalidCvv"
  | "generic";

export interface CheckoutStrings {
  /** This language's own name, shown on the toggle. */
  langName: string;
  languageLabel: string;
  loading: string;
  notFoundTitle: string;
  notFoundBody: string;
  expires: (date: string) => string;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
  payNow: (amount: string) => string;
  processing: string;
  notCompletedTitle: string;
  unableTitle: string;
  messages: Record<CheckoutMessageKey, string>;
  successTitle: string;
  successBody: string;
  transactionId: string;
  copyTransactionId: string;
  paidTo: string;
  paidAt: string;
  alreadyPaidTitle: string;
  expiredTitle: string;
  canceledTitle: string;
  processingTitle: string;
  processingBody: string;
  /** UX-70: every end screen has a way out inside the site. */
  backHome: string;
  refresh: string;
  testCardsTitle: string;
  testCardsApprove: string;
  testCardEnding: string;
  testCard0002: string;
  testCard0119: string;
  testCard0069: string;
  /** Scan-to-pay (merchant QR card and counter display). */
  scanToPay: string;
  waitingForPayment: string;
  paidThankYou: string;
  /** One line of the WhatsApp share text; the URL follows on its own line. */
  shareLine: (amount: string, merchant: string) => string;
}

const en: CheckoutStrings = {
  langName: "English",
  languageLabel: "Language",
  loading: "Loading payment…",
  notFoundTitle: "Payment link not found",
  notFoundBody: "This link doesn't exist. Check you have the full address.",
  expires: (date) => `Link expires ${date}`,
  cardNumber: "Card number",
  expiryMonth: "Month",
  expiryYear: "Year",
  cvv: "CVV",
  payNow: (amount) => `Pay ${amount}`,
  processing: "Processing…",
  notCompletedTitle: "Payment not completed",
  unableTitle: "Unable to pay",
  messages: {
    declined: "Your card was declined.",
    captureFailed: "Your payment could not be completed.",
    acquirerUnavailable: "The acquirer is temporarily unavailable. Please try again.",
    inProgress: "A payment is already being processed for this link. Please try again shortly.",
    alreadyPaid: "This has already been paid. Nothing more to do.",
    canceled: "This link isn't available any more.",
    expired: "This link has expired. Ask the shop to send a new one.",
    invalidCardNumber: "This card number is not valid. Check the digits and try again.",
    incompleteCardNumber: "Enter all 16 digits of your card number.",
    unsupportedCard: "Only Visa and Mastercard cards are accepted.",
    invalidExpiry: "Enter a valid expiry month (01 to 12) and year.",
    cardExpired: "This card has expired. Use another card.",
    invalidCvv: "The CVV is the 3 digits on the back of your card.",
    generic: "Something went wrong. Please try again.",
  },
  successTitle: "Payment successful",
  successBody: "Thank you — your payment has been received.",
  transactionId: "Transaction ID",
  copyTransactionId: "Copy transaction ID",
  paidTo: "Paid to",
  paidAt: "Paid at",
  alreadyPaidTitle: "Already paid",
  expiredTitle: "Link expired",
  canceledTitle: "No longer available",
  processingTitle: "Payment processing",
  processingBody: "Someone is paying this link right now. Wait a moment, then refresh.",
  backHome: "Back to home",
  refresh: "Refresh",
  testCardsTitle: "Test cards (simulated acquirer, no real charge)",
  testCardsApprove: "approves (any other valid Visa or Mastercard number approves too)",
  testCardEnding: "Card",
  testCard0002: "always declines (do not honor)",
  testCard0119: "always declines (insufficient funds)",
  testCard0069: "always errors",
  scanToPay: "Scan with your phone camera to pay",
  waitingForPayment: "Waiting for payment…",
  paidThankYou: "Paid — thank you!",
  shareLine: (amount, merchant) => `Pay ${amount} to ${merchant} securely with FilsPay:`,
};

const ar: CheckoutStrings = {
  langName: "عربي",
  languageLabel: "اللغة",
  loading: "جارٍ تحميل تفاصيل الدفع…",
  notFoundTitle: "رابط الدفع غير موجود",
  notFoundBody: "هذا الرابط غير موجود. تأكد من نسخ العنوان كاملاً.",
  expires: (date) => `ينتهي الرابط في ${date}`,
  cardNumber: "رقم البطاقة",
  expiryMonth: "الشهر",
  expiryYear: "السنة",
  cvv: "رمز التحقق (CVV)",
  payNow: (amount) => `ادفع الآن ${amount}`,
  processing: "جارٍ معالجة الدفع…",
  notCompletedTitle: "لم تكتمل عملية الدفع",
  unableTitle: "تعذّر إتمام الدفع",
  messages: {
    declined: "تم رفض البطاقة.",
    captureFailed: "تعذّر إتمام عملية الدفع.",
    acquirerUnavailable: "خدمة معالجة البطاقات غير متاحة مؤقتاً. يُرجى المحاولة مرة أخرى.",
    inProgress: "هناك عملية دفع قيد المعالجة لهذا الرابط. يُرجى المحاولة بعد قليل.",
    alreadyPaid: "تم دفع هذا المبلغ مسبقاً، ولا حاجة لأي إجراء آخر.",
    canceled: "هذا الرابط لم يعد متاحاً.",
    expired: "انتهت صلاحية هذا الرابط. اطلب من المتجر إرسال رابط جديد.",
    invalidCardNumber: "رقم البطاقة غير صحيح. تحقق من الأرقام وحاول مرة أخرى.",
    incompleteCardNumber: "أدخل أرقام البطاقة الستة عشر كاملة.",
    unsupportedCard: "نقبل بطاقات فيزا وماستركارد فقط.",
    invalidExpiry: "أدخل شهر انتهاء صحيحاً (من 01 إلى 12) وسنة صحيحة.",
    cardExpired: "انتهت صلاحية هذه البطاقة. استخدم بطاقة أخرى.",
    invalidCvv: "رمز التحقق هو الأرقام الثلاثة على ظهر البطاقة.",
    generic: "حدث خطأ ما. يُرجى المحاولة مرة أخرى.",
  },
  successTitle: "تم الدفع بنجاح",
  successBody: "شكراً لك، تم استلام دفعتك.",
  transactionId: "رقم العملية",
  copyTransactionId: "نسخ رقم العملية",
  paidTo: "المستفيد",
  paidAt: "وقت الدفع",
  alreadyPaidTitle: "تم الدفع مسبقاً",
  expiredTitle: "انتهت صلاحية الرابط",
  canceledTitle: "الرابط لم يعد متاحاً",
  processingTitle: "الدفع قيد المعالجة",
  processingBody: "هناك عملية دفع جارية لهذا الرابط الآن. انتظر قليلاً ثم حدّث الصفحة.",
  backHome: "العودة إلى الصفحة الرئيسية",
  refresh: "تحديث",
  testCardsTitle: "بطاقات تجريبية (محاكاة، لا يُخصم أي مبلغ فعلي)",
  testCardsApprove: "تتم الموافقة عليها (وكذلك أي رقم فيزا أو ماستركارد صحيح آخر)",
  testCardEnding: "البطاقة",
  testCard0002: "تُرفض دائماً (عدم الاعتماد)",
  testCard0119: "تُرفض دائماً (رصيد غير كافٍ)",
  testCard0069: "تُرجع خطأً دائماً",
  scanToPay: "امسح الرمز بكاميرا هاتفك للدفع",
  waitingForPayment: "بانتظار الدفع…",
  paidThankYou: "تم الدفع، شكراً لك!",
  shareLine: (amount, merchant) => `ادفع ${amount} إلى ${merchant} بأمان عبر FilsPay:`,
};

export const CHECKOUT_STRINGS: Record<CheckoutLang, CheckoutStrings> = { en, ar };

/** `<html dir>` value for a language. */
export function checkoutDir(lang: CheckoutLang): "ltr" | "rtl" {
  return lang === "ar" ? "rtl" : "ltr";
}

/** "4.750", "1,250.000" — integer fils in, via `@filspay/money` (never `/1000`). */
export function formatAmountDigits(amountFils: number): string {
  const text = formatBhd(toFils(amountFils));
  const [whole = "", frac] = text.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

/** The currency label for a language: "BD" / "د.ب" for BHD, else the ISO code. */
export function currencyLabel(lang: CheckoutLang, currency = "BHD"): string {
  if (currency !== "BHD") return currency;
  return lang === "ar" ? "د.ب" : "BD";
}

/** "BD 4.750" (en) or "4.750 د.ب" (ar). Western digits in both — see the module note. */
export function formatCheckoutAmount(amountFils: number, lang: CheckoutLang, currency = "BHD"): string {
  const digits = formatAmountDigits(amountFils);
  const label = currencyLabel(lang, currency);
  return lang === "ar" ? `${digits} ${label}` : `${label} ${digits}`;
}

const AR_DATE = new Intl.DateTimeFormat("ar-BH-u-nu-latn", {
  timeZone: "Asia/Bahrain",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const AR_TIME = new Intl.DateTimeFormat("ar-BH-u-nu-latn", {
  timeZone: "Asia/Bahrain",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * An instant in Bahrain time in the customer's language (Western digits):
 * "30 Oct 2026, 15:00" / "30 أكتوبر 2026، 15:00". Date and time are joined
 * by hand in Arabic so "ينتهي الرابط في …" never reads "في … في 15:00".
 */
export function formatCheckoutDateTime(iso: string | null | undefined, lang: CheckoutLang): string {
  if (!iso) return "—";
  if (lang === "en") return dateTime(iso);
  const date = new Date(iso);
  return `${AR_DATE.format(date)}، ${AR_TIME.format(date)}`;
}

/** Direction of a free-text value (a merchant's name), from its first letter. */
export function textDirection(text: string): "ltr" | "rtl" {
  const first = /[A-Za-zÀ-ɏ֐-ࣿ]/.exec(text)?.[0] ?? "a";
  return /[֐-ࣿ]/.test(first) ? "rtl" : "ltr";
}

/** First browser language decides: any `ar*` tag → Arabic, otherwise English. */
export function detectCheckoutLang(languages: readonly string[] | undefined): CheckoutLang {
  const first = languages?.[0]?.toLowerCase() ?? "";
  return first === "ar" || first.startsWith("ar-") ? "ar" : "en";
}

export const CHECKOUT_LANG_STORAGE_KEY = "filspay.checkout.lang";

type MinimalStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): MinimalStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined; // blocked storage (privacy mode, sandboxed iframe)
  }
}

/** The remembered choice, else the browser's language. Never throws. */
export function loadCheckoutLang(
  storage: MinimalStorage | undefined = defaultStorage(),
  languages: readonly string[] | undefined = typeof navigator === "undefined" ? undefined : navigator.languages,
): CheckoutLang {
  try {
    const saved = storage?.getItem(CHECKOUT_LANG_STORAGE_KEY);
    if (saved === "en" || saved === "ar") return saved;
  } catch {
    // unreadable storage — fall through to the browser language
  }
  return detectCheckoutLang(languages);
}

/** Remembers the choice when storage works; silently does nothing when it doesn't. */
export function saveCheckoutLang(lang: CheckoutLang, storage: MinimalStorage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(CHECKOUT_LANG_STORAGE_KEY, lang);
  } catch {
    // storage full or blocked — the choice still applies for this visit
  }
}

/** Right-to-left embedding (U+202B … U+202C). Chat apps lay a whole message
 *  out in the direction of its first letter, so without it the Arabic line of
 *  an English-first message is ordered left to right: the merchant's name and
 *  "FilsPay" jump around and the colon lands on the wrong side. */
const RTL_START = "‫";
const RTL_END = "‬";

/** The text a merchant shares: an English line, an Arabic line (kept
 *  right-to-left), a blank line, then the link once on its own line. */
export function buildShareText(amountFils: number, merchant: string, url: string): string {
  return [
    en.shareLine(formatCheckoutAmount(amountFils, "en"), merchant),
    RTL_START + ar.shareLine(formatCheckoutAmount(amountFils, "ar"), merchant) + RTL_END,
    "",
    url,
  ].join("\n");
}

/** WhatsApp's documented "click to chat" share link (the user picks the chat). */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
