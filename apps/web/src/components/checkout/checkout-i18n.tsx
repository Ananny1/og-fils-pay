import type { ReactNode } from "react";
import { CHECKOUT_LANGS, CHECKOUT_STRINGS, currencyLabel, formatAmountDigits } from "../../i18n/checkout.js";
import { useCheckoutLang } from "../../i18n/use-checkout-lang.js";
import { cn } from "@/lib/utils";
import "./checkout-rtl.css";

/**
 * ENH-011 — the language layer of the public checkout: the root that sets
 * `dir` + `lang`, the English | عربي toggle, and the amount display.
 */
export function CheckoutLangRoot({ children }: { children: ReactNode }) {
  const { lang, dir } = useCheckoutLang();
  return (
    <div dir={dir} lang={lang} className={cn(lang === "ar" && "fp-ar")}>
      {children}
    </div>
  );
}

/** Segmented "English | عربي" switch. Each label is written in its own language. */
export function CheckoutLangToggle({ className }: { className?: string }) {
  const { lang, t, setLang } = useCheckoutLang();
  return (
    <div
      role="group"
      aria-label={t.languageLabel}
      className={cn("inline-flex shrink-0 items-center rounded-lg border border-border bg-card p-0.5 text-xs", className)}
    >
      {CHECKOUT_LANGS.map((option) => {
        const active = option === lang;
        return (
          <button
            key={option}
            type="button"
            lang={option}
            dir={option === "ar" ? "rtl" : "ltr"}
            aria-pressed={active}
            onClick={() => setLang(option)}
            className={cn(
              "min-w-14 rounded-md px-2.5 py-1 font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              option === "ar" ? "font-['IBM_Plex_Sans_Arabic',_sans-serif] text-[0.8rem]" : "uppercase tracking-[0.08em]",
              active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {CHECKOUT_STRINGS[option].langName}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "BD 4.750" / "4.750 د.ب". The digits are an isolated left-to-right run in
 * both languages, so separators never flip; only the label changes side.
 */
export function CheckoutAmount({
  fils,
  currency = "BHD",
  className,
}: {
  fils: number;
  currency?: string;
  className?: string;
}) {
  const { lang } = useCheckoutLang();
  const label = <span className="text-[0.55em] font-medium text-muted-foreground">{currencyLabel(lang, currency)}</span>;
  return (
    <span className={cn("inline-flex items-baseline gap-2 whitespace-nowrap", className)}>
      {lang === "en" ? label : null}
      <bdi dir="ltr" className="font-mono tabular-nums">
        {formatAmountDigits(fils)}
      </bdi>
      {lang === "ar" ? label : null}
    </span>
  );
}
