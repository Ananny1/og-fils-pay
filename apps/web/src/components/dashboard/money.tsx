import { formatBhd, toFils } from "@filspay/money";
import { cn } from "@/lib/utils";

/**
 * Money display. Always goes through `@filspay/money`'s `formatBhd` so there
 * is exactly one way a BHD amount is rendered (3 decimals, integer fils in,
 * never `/1000` or `toFixed`). Negative values (refunds, gaps) are allowed
 * here because they are display-only.
 */
export function formatMoney(amountFils: number): string {
  const negative = amountFils < 0;
  const text = formatBhd(toFils(Math.abs(amountFils)));
  // Thousands separators on the integer part only — a string edit, so the
  // digits are exactly what formatBhd produced.
  const [whole = "", frac] = text.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}${grouped}${frac !== undefined ? `.${frac}` : ""}`;
}

export function Money({
  fils,
  currency = "BHD",
  className,
  signed = false,
}: {
  fils: number;
  currency?: string;
  className?: string;
  /** Prefix a `+` on positive amounts (for deltas). */
  signed?: boolean;
}) {
  const text = formatMoney(fils);
  return (
    <span className={cn("font-mono tabular-nums whitespace-nowrap", fils < 0 && "text-destructive", className)}>
      {signed && fils > 0 ? "+" : ""}
      {text}
      <span className="ml-1 text-[0.8em] text-muted-foreground">{currency}</span>
    </span>
  );
}
