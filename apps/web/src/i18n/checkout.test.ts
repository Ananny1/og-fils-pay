import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECKOUT_LANGS,
  CHECKOUT_LANG_STORAGE_KEY,
  CHECKOUT_STRINGS,
  buildShareText,
  checkoutDir,
  detectCheckoutLang,
  formatCheckoutAmount,
  formatCheckoutDateTime,
  loadCheckoutLang,
  saveCheckoutLang,
  textDirection,
  whatsappShareUrl,
} from "./checkout.js";

/**
 * ENH-011 — the checkout dictionary. A missing Arabic string would show a
 * blank label to a paying customer, and a wrong amount format misstates money,
 * so both are pinned here.
 */

const ARABIC = /[؀-ۿ]/;

function keysDeep(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => keysDeep(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

function valueAt(strings: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], strings);
}

function render(value: unknown): string {
  // Function entries take placeholders; call them with recognisable ones.
  return typeof value === "function" ? String((value as (...a: string[]) => string)("‹A›", "‹B›", "‹C›")) : String(value);
}

test("English and Arabic have exactly the same keys", () => {
  assert.deepEqual(keysDeep(CHECKOUT_STRINGS.ar), keysDeep(CHECKOUT_STRINGS.en));
  assert.deepEqual([...CHECKOUT_LANGS].sort(), Object.keys(CHECKOUT_STRINGS).sort());
});

test("every string is non-empty in both languages, and every Arabic one is actually Arabic", () => {
  for (const key of keysDeep(CHECKOUT_STRINGS.en)) {
    const en = render(valueAt(CHECKOUT_STRINGS.en, key));
    const ar = render(valueAt(CHECKOUT_STRINGS.ar, key));
    assert.ok(en.trim().length > 0, `en.${key} is empty`);
    assert.ok(ar.trim().length > 0, `ar.${key} is empty`);
    assert.ok(ARABIC.test(ar), `ar.${key} has no Arabic text: ${ar}`);
    assert.ok(!ARABIC.test(en), `en.${key} contains Arabic text: ${en}`);
  }
});

test("templated strings keep their placeholders in both languages", () => {
  for (const lang of CHECKOUT_LANGS) {
    const t = CHECKOUT_STRINGS[lang];
    assert.ok(t.payNow("‹A›").includes("‹A›"), `${lang}.payNow`);
    assert.ok(t.expires("‹A›").includes("‹A›"), `${lang}.expires`);
    const line = t.shareLine("‹A›", "‹B›");
    assert.ok(line.includes("‹A›") && line.includes("‹B›"), `${lang}.shareLine`);
  }
});

test("the agreed payment wording is used in Arabic", () => {
  const ar = CHECKOUT_STRINGS.ar;
  assert.match(ar.payNow("x"), /^ادفع الآن /);
  assert.equal(ar.successTitle, "تم الدفع بنجاح");
  assert.equal(ar.messages.declined, "تم رفض البطاقة.");
  assert.match(ar.expires("x"), /^ينتهي الرابط في /);
});

test("amounts: BD prefix in English, د.ب suffix in Arabic, Western digits and 3 decimals in both", () => {
  assert.equal(formatCheckoutAmount(4750, "en"), "BD 4.750");
  assert.equal(formatCheckoutAmount(4750, "ar"), "4.750 د.ب");
  assert.equal(formatCheckoutAmount(12500, "en"), "BD 12.500");
  assert.equal(formatCheckoutAmount(1, "ar"), "0.001 د.ب");
  assert.equal(formatCheckoutAmount(0, "en"), "BD 0.000");
  assert.equal(formatCheckoutAmount(1_250_000, "en"), "BD 1,250.000");
  assert.equal(formatCheckoutAmount(1_250_000, "ar"), "1,250.000 د.ب");
  // Never Arabic-Indic digits: card amounts must read the same in both languages.
  assert.doesNotMatch(formatCheckoutAmount(987654, "ar"), /[٠-٩]/);
  // A non-BHD currency keeps its ISO code rather than borrowing the BD label.
  assert.equal(formatCheckoutAmount(5000, "en", "USD"), "USD 5.000");
});

test("amount formatting refuses a non-integer fils value instead of rounding it", () => {
  assert.throws(() => formatCheckoutAmount(4.75, "en"));
});

test("dates are Bahrain time, in the customer's language, with Western digits", () => {
  const iso = "2026-10-30T12:00:00.000Z"; // 15:00 in Bahrain (UTC+3)
  assert.match(formatCheckoutDateTime(iso, "en"), /30 Oct 2026, 15:00/);
  const ar = formatCheckoutDateTime(iso, "ar");
  assert.match(ar, /أكتوبر/);
  assert.match(ar, /30/);
  assert.match(ar, /15:00/);
  assert.doesNotMatch(ar, /[٠-٩]/);
  assert.equal(formatCheckoutDateTime(null, "ar"), "—");
  // "ينتهي الرابط في <date>" must not say "في" twice.
  assert.equal(CHECKOUT_STRINGS.ar.expires(ar).split("في").length - 1, 1);
});

test("a merchant name's direction comes from its first letter", () => {
  assert.equal(textDirection("Delta Wholesale Traders"), "ltr");
  assert.equal(textDirection("مخبز المنامة"), "rtl");
  assert.equal(textDirection("123 مخبز"), "rtl");
  assert.equal(textDirection("7-Eleven البحرين"), "ltr");
  assert.equal(textDirection(""), "ltr");
});

test("direction follows the language", () => {
  assert.equal(checkoutDir("ar"), "rtl");
  assert.equal(checkoutDir("en"), "ltr");
});

test("default language comes from the browser: any ar-* tag picks Arabic", () => {
  assert.equal(detectCheckoutLang(["ar-BH", "en"]), "ar");
  assert.equal(detectCheckoutLang(["ar"]), "ar");
  assert.equal(detectCheckoutLang(["en-GB", "ar-BH"]), "en");
  assert.equal(detectCheckoutLang(["arn"]), "en"); // Mapudungun, not Arabic
  assert.equal(detectCheckoutLang([]), "en");
  assert.equal(detectCheckoutLang(undefined), "en");
});

test("the saved choice wins over the browser language, and broken storage never throws", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(loadCheckoutLang(storage, ["ar-BH"]), "ar");
  saveCheckoutLang("en", storage);
  assert.equal(store.get(CHECKOUT_LANG_STORAGE_KEY), "en");
  assert.equal(loadCheckoutLang(storage, ["ar-BH"]), "en");

  store.set(CHECKOUT_LANG_STORAGE_KEY, "fr"); // junk value: ignored
  assert.equal(loadCheckoutLang(storage, ["ar"]), "ar");

  const broken = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(loadCheckoutLang(broken, ["ar-SA"]), "ar");
  assert.doesNotThrow(() => saveCheckoutLang("ar", broken));
  assert.equal(loadCheckoutLang(undefined, undefined), "en");
});

test("the WhatsApp share text carries both languages and the exact link once", () => {
  const url = "https://pay.filspay.example/pay/AbC123_-x";
  const text = buildShareText(12500, "Delta Wholesale", url);
  assert.deepEqual(text.split("\n"), [
    "Pay BD 12.500 to Delta Wholesale securely with FilsPay:",
    // Wrapped in a right-to-left embedding so an English-first chat bubble
    // keeps the Arabic word order (merchant name and colon in place).
    "‫ادفع 12.500 د.ب إلى Delta Wholesale بأمان عبر FilsPay:‬",
    "",
    url,
  ]);
  assert.equal(text.split(url).length, 2, "the link appears exactly once");
  const share = whatsappShareUrl(text);
  assert.ok(share.startsWith("https://wa.me/?text="));
  assert.equal(decodeURIComponent(share.slice("https://wa.me/?text=".length)), text);
});
