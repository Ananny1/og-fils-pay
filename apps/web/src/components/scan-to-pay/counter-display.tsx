import { CheckCircle2, Clock, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getPaymentLink } from "../../api/paymentLinks.js";
import { CHECKOUT_STRINGS, currencyLabel, formatAmountDigits } from "../../i18n/checkout.js";
import { ensureArabicFont } from "../../i18n/use-checkout-lang.js";
import { dateTime } from "../../format.js";
import type { PaymentLinkDto } from "../../types.js";
import { BrandMark } from "@/components/dashboard/public-shell";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { QrCode } from "./qr-code";
import "../checkout/checkout-rtl.css";

/** How often the counter screen asks the public read whether the link was paid. */
const POLL_MS = 4000;

/**
 * ENH-011 — full-screen "counter display": the QR as large as the screen
 * allows, the amount, and the bilingual caption, for a tablet or monitor
 * facing the customer. It watches the public link status and flips to a
 * "Paid" screen the moment the customer's payment lands. Esc closes.
 */
export function CounterDisplay({
  link,
  merchantName,
  onClose,
  onPaid,
}: {
  link: PaymentLinkDto;
  merchantName: string;
  onClose: () => void;
  onPaid?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLElement>(null);
  const [paid, setPaid] = useState(false);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  // Esc, focus, scroll lock, and the browser's own full-screen mode when allowed.
  useEffect(() => {
    ensureArabicFont();
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let enteredFullscreen = false;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onFullscreenChange = () => {
      if (document.fullscreenElement) enteredFullscreen = true;
      else if (enteredFullscreen) onClose(); // Esc in native full screen is eaten by the browser
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    rootRef.current?.requestFullscreen?.().catch(() => {
      // not allowed (iframe, old browser) — the fixed overlay is full-window anyway
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.body.style.overflow = previousOverflow;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onClose]);

  // Watch for the payment (public, unauthenticated read — the same one /pay uses).
  useEffect(() => {
    if (paid) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      getPaymentLink(link.token)
        .then((current) => {
          if (cancelled || current.status !== "paid") return;
          setPaid(true);
          onPaidRef.current?.();
        })
        .catch(() => {
          // offline for a moment — try again on the next tick
        });
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [link.token, paid]);

  const en = CHECKOUT_STRINGS.en;
  const ar = CHECKOUT_STRINGS.ar;

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Counter display: ${merchantName}`}
      className="fixed inset-0 z-[100] flex flex-col overflow-auto bg-background text-foreground"
    >
      <div className="h-1.5 w-full shrink-0 bg-[#c8102e]" aria-hidden="true" />
      <header className="flex items-center justify-between gap-4 px-6 py-4 sm:px-10">
        <BrandMark />
        <div className="flex items-center gap-3">
          {!paid ? (
            <span className="hidden items-center gap-2 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground sm:inline-flex">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-success" />
              </span>
              {en.waitingForPayment}
            </span>
          ) : null}
          <Button ref={closeRef} variant="outline" onClick={onClose}>
            <X data-icon="inline-start" />
            Close <Kbd className="ml-1">Esc</Kbd>
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-10 landscape:flex-row landscape:gap-16 sm:px-10">
        {paid ? (
          <div className="flex flex-col items-center gap-6 text-center" role="status">
            <span className="flex size-28 items-center justify-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="size-16" aria-hidden="true" />
            </span>
            <p className="font-heading text-5xl font-semibold tracking-tight">{en.paidThankYou}</p>
            <p dir="rtl" lang="ar" className="fp-ar text-4xl font-semibold">
              {ar.paidThankYou}
            </p>
            <p className="font-mono text-5xl font-semibold tabular-nums">
              <span className="me-3 text-[0.5em] text-muted-foreground">{currencyLabel("en", link.currency)}</span>
              {formatAmountDigits(link.amountFils)}
            </p>
          </div>
        ) : (
          <>
            <div className="relative bg-white p-3 shadow-card ring-1 ring-border">
              <ViewfinderCorners />
              <QrCode
                value={link.url}
                label={`QR code for ${link.url}`}
                className="size-[min(62svh,82vw,640px)] landscape:size-[min(78svh,46vw,680px)]"
              />
            </div>
            <div className="flex max-w-xl flex-col items-center gap-5 text-center landscape:items-start landscape:text-start">
              <p className="case-label w-full">{merchantName}</p>
              <p className="font-mono text-6xl font-semibold tabular-nums tracking-tight sm:text-7xl">
                <span className="me-3 text-[0.45em] font-medium text-muted-foreground">{currencyLabel("en", link.currency)}</span>
                {formatAmountDigits(link.amountFils)}
              </p>
              {link.description ? <p className="text-xl text-muted-foreground">{link.description}</p> : null}
              <div className="flex flex-col gap-2">
                <p className="text-2xl font-medium sm:text-3xl">{en.scanToPay}</p>
                <p dir="rtl" lang="ar" className="fp-ar text-2xl font-medium sm:text-3xl">
                  {ar.scanToPay}
                </p>
              </div>
              <p className="inline-flex items-center gap-2 font-mono text-sm text-muted-foreground">
                <Clock className="size-4" aria-hidden="true" />
                {en.expires(dateTime(link.expiresAt))}
              </p>
            </div>
          </>
        )}
      </main>
    </div>,
    document.body,
  );
}

/** Red camera-viewfinder corners around the QR plate — "point your camera here". */
export function ViewfinderCorners() {
  const corner = "pointer-events-none absolute size-7 border-[#c8102e]";
  return (
    <>
      <span aria-hidden="true" className={`${corner} -left-2 -top-2 border-l-4 border-t-4`} />
      <span aria-hidden="true" className={`${corner} -right-2 -top-2 border-r-4 border-t-4`} />
      <span aria-hidden="true" className={`${corner} -bottom-2 -left-2 border-b-4 border-l-4`} />
      <span aria-hidden="true" className={`${corner} -bottom-2 -right-2 border-b-4 border-r-4`} />
    </>
  );
}
