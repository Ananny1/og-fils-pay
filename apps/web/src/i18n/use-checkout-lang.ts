import { useEffect, useSyncExternalStore } from "react";
import {
  CHECKOUT_STRINGS,
  checkoutDir,
  loadCheckoutLang,
  saveCheckoutLang,
  type CheckoutLang,
  type CheckoutStrings,
} from "./checkout.js";

/*
 * The checkout language as a tiny shared store (no provider): the page body
 * and its shell both call `useCheckoutLang()` and always agree. Read lazily
 * on first use so the browser's language and localStorage are only touched
 * in the browser.
 */
let current: CheckoutLang | null = null;
const listeners = new Set<() => void>();

function getLang(): CheckoutLang {
  if (current === null) current = loadCheckoutLang();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setCheckoutLang(lang: CheckoutLang): void {
  current = lang;
  saveCheckoutLang(lang);
  listeners.forEach((listener) => listener());
}

const ARABIC_FONT_HREF =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap";

/** Loads the Arabic face only for visitors who actually read Arabic. */
export function ensureArabicFont(): void {
  if (typeof document === "undefined" || document.getElementById("fp-arabic-font")) return;
  const link = document.createElement("link");
  link.id = "fp-arabic-font";
  link.rel = "stylesheet";
  link.href = ARABIC_FONT_HREF;
  document.head.appendChild(link);
}

export function useCheckoutLang(): {
  lang: CheckoutLang;
  t: CheckoutStrings;
  dir: "ltr" | "rtl";
  setLang: (lang: CheckoutLang) => void;
} {
  const lang = useSyncExternalStore(subscribe, getLang, () => "en" as CheckoutLang);
  useEffect(() => {
    if (lang === "ar") ensureArabicFont();
  }, [lang]);
  return { lang, t: CHECKOUT_STRINGS[lang], dir: checkoutDir(lang), setLang: setCheckoutLang };
}
