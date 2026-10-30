import { CheckCircle2, Clock, Copy, Download, Hourglass, MessageCircle, MonitorSmartphone, Ban } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CHECKOUT_STRINGS, buildShareText, currencyLabel, formatAmountDigits, whatsappShareUrl } from "../../i18n/checkout.js";
import { ensureArabicFont } from "../../i18n/use-checkout-lang.js";
import { dateTime } from "../../format.js";
import type { PaymentLinkDto } from "../../types.js";
import { qrPayload, scanToPayState, type ScanToPayState } from "@/lib/qr";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CounterDisplay, ViewfinderCorners } from "./counter-display";
import { QrCode } from "./qr-code";
import { downloadBlob, renderQrPoster } from "./qr-poster";
import "../checkout/checkout-rtl.css";

/** Re-check expiry while the page stays open, so a QR never outlives its link. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const CLOSED_STATES: Record<Exclude<ScanToPayState, "active">, { stamp: string; ink: string; icon: typeof Ban; text: string }> = {
  paid: { stamp: "Paid", ink: "case-stamp--ink", icon: CheckCircle2, text: "This link has been paid. There is nothing left to scan." },
  processing: {
    stamp: "In progress",
    ink: "",
    icon: Hourglass,
    text: "A customer is paying this link right now. The QR is hidden so nobody else starts a second payment.",
  },
  expired: { stamp: "Expired", ink: "case-stamp--muted", icon: Clock, text: "This link has expired, so its QR would only lead to an error. Create a new link to take payment." },
  canceled: { stamp: "Canceled", ink: "", icon: Ban, text: "This link was canceled. Its QR is no longer shown." },
};

/**
 * ENH-011 — "Scan to pay": the payment link as a QR the customer scans with
 * any phone camera (no app), plus the merchant's ways to get it in front of
 * them: copy, WhatsApp, a printable PNG, and a full-screen counter display.
 */
export function ScanToPayCard({
  link,
  merchantName,
  onPaid,
}: {
  link: PaymentLinkDto;
  merchantName: string;
  onPaid?: () => void;
}) {
  const now = useNow(30_000);
  const state = scanToPayState(link, now);
  const [counterOpen, setCounterOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const closeCounter = useCallback(() => setCounterOpen(false), []);

  useEffect(() => {
    ensureArabicFont();
  }, []);

  const en = CHECKOUT_STRINGS.en;
  const ar = CHECKOUT_STRINGS.ar;
  const payload = state === "active" ? qrPayload(link) : null;

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success("Checkout link copied");
    } catch {
      toast.error("Could not copy — select the link and copy it by hand");
    }
  }

  async function downloadPng(): Promise<void> {
    setDownloading(true);
    try {
      const blob = await renderQrPoster({
        url: link.url,
        merchant: merchantName,
        amountFils: link.amountFils,
        currency: link.currency,
        expiresAt: link.expiresAt,
      });
      downloadBlob(blob, `filspay-qr-${(link.reference ?? link.token.slice(0, 8)).replace(/[^\w-]+/g, "-")}.png`);
    } catch {
      toast.error("Could not create the PNG in this browser");
    } finally {
      setDownloading(false);
    }
  }

  const closed = state === "active" ? null : CLOSED_STATES[state];

  return (
    <Card data-testid="scan-to-pay">
      <CardHeader>
        <CardTitle className="case-label">Scan to pay</CardTitle>
        <CardDescription>
          Customers scan with any phone camera — no app to install. The code holds only this link&apos;s checkout URL.
        </CardDescription>
        <CardAction>
          {state === "active" ? (
            <span className="case-stamp case-stamp--ink">Live</span>
          ) : (
            <span className={`case-stamp ${closed?.ink ?? ""}`}>{closed?.stamp}</span>
          )}
        </CardAction>
      </CardHeader>

      <CardContent className="grid items-center gap-8 md:grid-cols-[minmax(0,15rem)_1fr]">
        {/* The plate: always light, even in dark mode, so cameras read it. */}
        <div className="mx-auto w-full max-w-60">
          {payload ? (
            <div className="relative bg-white p-2 shadow-card ring-1 ring-border">
              <ViewfinderCorners />
              <QrCode value={payload} label={`QR code for ${payload}`} />
            </div>
          ) : closed ? (
            <div className="flex aspect-square flex-col items-center justify-center gap-3 border-2 border-dashed border-border bg-muted/40 p-6 text-center">
              <closed.icon className="size-10 text-muted-foreground" aria-hidden="true" />
              <span className={`case-stamp text-sm ${closed.ink}`}>{closed.stamp}</span>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Pay to</span>
            <span className="font-heading text-xl font-semibold uppercase tracking-wide">{merchantName}</span>
          </div>
          <p className="font-mono text-4xl font-semibold tabular-nums tracking-tight">
            <span className="me-2 text-[0.5em] font-medium text-muted-foreground">{currencyLabel("en", link.currency)}</span>
            {formatAmountDigits(link.amountFils)}
          </p>

          {closed ? (
            <p className="max-w-prose text-sm text-muted-foreground">{closed.text}</p>
          ) : (
            <>
              <div className="flex flex-col gap-1 border-s-2 border-[var(--case-red)] ps-3">
                <p className="text-sm font-medium">{en.scanToPay}</p>
                <p dir="rtl" lang="ar" className="fp-ar w-fit text-sm font-medium">
                  {ar.scanToPay}
                </p>
              </div>
              <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5" aria-hidden="true" />
                {en.expires(dateTime(link.expiresAt))} (Bahrain time)
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setCounterOpen(true)}>
                  <MonitorSmartphone data-icon="inline-start" />
                  Counter display
                </Button>
                <Button variant="outline" onClick={() => void copyLink()}>
                  <Copy data-icon="inline-start" />
                  Copy link
                </Button>
                <Button
                  variant="outline"
                  render={
                    <a
                      href={whatsappShareUrl(buildShareText(link.amountFils, merchantName, link.url))}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <MessageCircle data-icon="inline-start" />
                  WhatsApp
                </Button>
                <Button variant="outline" disabled={downloading} onClick={() => void downloadPng()}>
                  <Download data-icon="inline-start" />
                  {downloading ? "Preparing…" : "Download PNG"}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>

      {counterOpen ? (
        <CounterDisplay link={link} merchantName={merchantName} onClose={closeCounter} onPaid={onPaid} />
      ) : null}
    </Card>
  );
}
