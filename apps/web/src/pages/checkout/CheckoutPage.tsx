import { Ban, CheckCircle2, Clock, CreditCard, Hourglass, LockKeyhole, SearchX, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPaymentLink, payPaymentLink } from "../../api/paymentLinks.js";
import { ApiError } from "../../api/client.js";
import { formatCardBrandHint, isValidCardNumber } from "../../utils/helpers.js";
import type { PaymentLinkPublicDto, PayPaymentLinkResponse, SimulatedCardInput } from "../../types.js";
// ENH-011: English / Arabic checkout
import { formatCheckoutAmount, formatCheckoutDateTime, textDirection, type CheckoutMessageKey } from "../../i18n/checkout.js";
import { useCheckoutLang } from "../../i18n/use-checkout-lang.js";
import { CheckoutAmount, CheckoutLangRoot, CheckoutLangToggle } from "@/components/checkout/checkout-i18n";
import BlurText from "@/components/ui/BlurText";
import FadeContent from "@/components/ui/FadeContent";
import { CopyButton } from "@/components/dashboard/copy-button";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { BrandMark, PublicShell } from "@/components/dashboard/public-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "loaded"; link: PaymentLinkPublicDto };

type PayState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; result: PayPaymentLinkResponse }
  | { kind: "declined"; message: CheckoutMessageKey; detail?: string; retryable: boolean }
  | { kind: "terminal"; message: CheckoutMessageKey };

/** 400 codes from the API's card check (BUG-063) → the message shown. */
const CARD_PROBLEM_MESSAGES: Record<string, CheckoutMessageKey> = {
  invalid_card_number: "invalidCardNumber",
  unsupported_card_brand: "unsupportedCard",
  invalid_expiry: "invalidExpiry",
  card_expired: "cardExpired",
  invalid_cvv: "invalidCvv",
};

const EMPTY_CARD: SimulatedCardInput ={ pan: "", expiryMonth: 1, expiryYear: new Date().getFullYear() + 1, cvv: "" };

export function CheckoutPage() {
  const { token } = useParams<{ token: string }>();
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [payState, setPayState] = useState<PayState>({ kind: "idle" });
  const [card, setCard] = useState<SimulatedCardInput>(EMPTY_CARD);
  const [brandHint, setBrandHint] = useState<string | null>(null);
  // Expiry is typed as text so "01" stays "01"; it becomes numbers only on submit.
  const [expiry, setExpiry] = useState({ month: "", year: "" });

  // After a retryable decline, put the cursor back in the card number so the
  // customer can fix it or try another card straight away. (The shadcn Input
  // doesn't forward refs on React 18, so look it up by id.)
  useEffect(() => {
    if (payState.kind === "declined") document.getElementById("checkout-pan")?.focus();
  }, [payState]);

  const loadedLink = loadState.kind === "loaded" ? loadState.link : null;
  useEffect(() => {
    if (loadedLink) document.title = `Pay ${loadedLink.merchantDisplayName} · FilsPay`;
  }, [loadedLink]);
  const { lang, t } = useCheckoutLang();

  // FH: memory leak — this effect never aborts the fetch on unmount (React warning in console?)
  // theres a cancelled flag in the cleanup tho. warning must be from somewhere else — am
  useEffect(() => {
    if (!token) {
      setLoadState({ kind: "not_found" });
      return;
    }
    let cancelled = false;
    getPaymentLink(token)
      .then((link) => {
        if (!cancelled) setLoadState({ kind: "loaded", link });
      })
      .catch(() => {
        // Never distinguishes "malformed token" from "doesn't exist" —
        // matches the API's own non-disclosure choice.
        if (!cancelled) setLoadState({ kind: "not_found" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!token) return;
    // Same rules as the server (BUG-063), so a typo is caught before any request.
    if (!isValidCardNumber(card.pan)) {
      const brandKnown = formatCardBrandHint(card.pan) !== "unknown";
      setPayState({ kind: "declined", message: brandKnown ? "invalidCardNumber" : "unsupportedCard", retryable: true });
      return;
    }

    // A fresh Idempotency-Key per explicit user action — every click,
    // including a "try again" after a decline, is a new attempt.
    const idempotencyKey = crypto.randomUUID();
    setPayState({ kind: "submitting" });

    try {
      const result = await payPaymentLink(
        token,
        { card: { ...card, expiryMonth: Number(expiry.month), expiryYear: Number(expiry.year) } },
        idempotencyKey,
      );
      setPayState({ kind: "success", result });
    } catch (err) {
      if (err instanceof ApiError) {
        const { statusCode, body } = err;
        if (statusCode === 402) {
          const stageLabel = body.stage === "capture" ? "captureFailed" : "declined";
          setPayState({ kind: "declined", message: stageLabel, retryable: true });
        } else if (statusCode === 502) {
          setPayState({ kind: "declined", message: "acquirerUnavailable", retryable: true });
        } else if (statusCode === 409 && body.error === "payment_link_already_paid") {
          setPayState({ kind: "terminal", message: "alreadyPaid" });
        } else if (statusCode === 409 && body.error === "payment_link_canceled") {
          setPayState({ kind: "terminal", message: "canceled" });
        } else if (statusCode === 409) {
          setPayState({ kind: "declined", message: "inProgress", retryable: true });
        } else if (statusCode === 410) {
          setPayState({ kind: "terminal", message: "expired" });
        } else if (statusCode === 400 && typeof body.error === "string" && body.error in CARD_PROBLEM_MESSAGES) {
          setPayState({ kind: "declined", message: CARD_PROBLEM_MESSAGES[body.error]!, retryable: true });
        } else {
          setPayState({ kind: "declined", message: "generic", detail: body.message, retryable: true });
        }
      } else {
        setPayState({ kind: "declined", message: "generic", retryable: true });
      }
    }
  }

  if (loadState.kind === "loading") {
    return (
      <CheckoutShell>
        <Card className="w-full gap-0 py-0" aria-busy="true" aria-label={t.loading}>
          <div className="flex flex-col items-center gap-3 border-b border-border bg-muted/40 px-6 py-8">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-44" />
          </div>
          <CardContent className="flex flex-col gap-4 py-6">
            <Skeleton className="h-8 w-full" />
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      </CheckoutShell>
    );
  }

  if (loadState.kind === "not_found") {
    return (
      <CheckoutShell>
        <CheckoutStatusCard
          icon={SearchX}
          tone="muted"
          title={t.notFoundTitle}
          description={t.notFoundBody}
        />
      </CheckoutShell>
    );
  }

  const { link } = loadState;

  if (payState.kind === "success") {
    const { result } = payState;
    return (
      <CheckoutShell>
        <Card className="w-full gap-0 py-0">
          <CardContent className="flex flex-col items-center gap-5 px-6 py-8 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="size-8" aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-1">
              <h1 className="font-heading text-xl font-semibold tracking-tight">{t.successTitle}</h1>
              <p className="text-sm text-muted-foreground">{t.successBody}</p>
            </div>
            <CheckoutAmount fils={result.amountFils} className="text-3xl font-semibold" />
            <dl className="w-full divide-y divide-border rounded-lg border border-border text-start text-sm">
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="shrink-0 text-muted-foreground">{t.transactionId}</dt>
                <dd className="flex min-w-0 items-center gap-1">
                  <span dir="ltr" className="truncate font-mono text-xs">{result.transactionId}</span>
                  <CopyButton value={result.transactionId} label={t.copyTransactionId} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="shrink-0 text-muted-foreground">{t.paidTo}</dt>
                <dd dir="auto" className="truncate font-medium">{link.merchantDisplayName}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="shrink-0 text-muted-foreground">{t.paidAt}</dt>
                <dd className="text-xs tabular-nums">{formatCheckoutDateTime(result.paidAt, lang)}</dd>
              </div>
            </dl>
            <BackHomeButton label={t.backHome} />
          </CardContent>
        </Card>
      </CheckoutShell>
    );
  }

  if (payState.kind === "terminal") {
    return (
      <CheckoutShell>
        <CheckoutStatusCard icon={Ban} tone="destructive" title={t.unableTitle} description={t.messages[payState.message]} />
      </CheckoutShell>
    );
  }

  if (link.status === "paid") {
    return (
      <CheckoutShell>
        <CheckoutStatusCard
          icon={CheckCircle2}
          tone="success"
          title={t.alreadyPaidTitle}
          description={t.messages.alreadyPaid}
          link={link}
        />
      </CheckoutShell>
    );
  }
  if (link.status === "expired") {
    return (
      <CheckoutShell>
        <CheckoutStatusCard
          icon={Clock}
          tone="muted"
          title={t.expiredTitle}
          description={t.messages.expired}
          link={link}
        />
      </CheckoutShell>
    );
  }
  if (link.status === "canceled") {
    return (
      <CheckoutShell>
        <CheckoutStatusCard
          icon={Ban}
          tone="destructive"
          title={t.canceledTitle}
          description={t.messages.canceled}
          link={link}
        />
      </CheckoutShell>
    );
  }
  if (link.status === "processing") {
    return (
      <CheckoutShell>
        <CheckoutStatusCard
          icon={Hourglass}
          tone="muted"
          title={t.processingTitle}
          description={t.processingBody}
          onRefresh={() => window.location.reload()}
        />
      </CheckoutShell>
    );
  }

  // link.status === 'active'
  const submitting = payState.kind === "submitting";
  const showBrand = brandHint !== null && brandHint !== "unknown";

  return (
    <CheckoutShell>
      <Card className="w-full gap-0 py-0 shadow-lg shadow-foreground/5">
        <div className="flex flex-col items-center gap-2 border-b border-border bg-muted/40 px-6 py-7 text-center">
          <h1 className="sr-only">Pay {link.merchantDisplayName}</h1>
          <BlurText
            text={link.merchantDisplayName}
            trigger="load"
            animateBy="words"
            delay={60}
            stepDuration={0.3}
            className={`justify-center text-sm font-medium text-muted-foreground ${textDirection(link.merchantDisplayName) === "rtl" ? "[direction:rtl]" : "[direction:ltr]"}`}
          />
          <CheckoutAmount fils={link.amountFils} currency={link.currency} className="text-4xl font-semibold tracking-tight" />
          {link.description ? <p className="text-sm text-foreground">{link.description}</p> : null}
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
            {link.reference ? (
              <Badge variant="outline" dir="ltr" className="font-mono">
                {link.reference}
              </Badge>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden="true" />
              {t.expires(formatCheckoutDateTime(link.expiresAt, lang))}
            </span>
          </div>
        </div>

        <CardContent className="flex flex-col gap-4 py-6">
          {payState.kind === "declined" ? (
            <ErrorAlert
              message={lang === "en" && payState.detail ? payState.detail : t.messages[payState.message]}
              title={t.notCompletedTitle}
            />
          ) : null}

          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <fieldset disabled={submitting} className="contents">
                <Field>
                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor="checkout-pan">{t.cardNumber}</FieldLabel>
                    {showBrand ? (
                      <Badge variant="secondary" dir="ltr" className="uppercase tracking-wide">
                        <CreditCard aria-hidden="true" />
                        {brandHint}
                      </Badge>
                    ) : null}
                  </div>
                  <Input
                    id="checkout-pan"
                    type="text"
                    inputMode="numeric"
                    autoComplete="cc-number"
                    dir="ltr"
                    required
                    maxLength={23}
                    placeholder="1234 5678 9012 3456"
                    className="h-11 font-mono"
                    value={card.pan}
                    onChange={(e) => {
                      const pan = e.target.value;
                      setCard({ ...card, pan });
                      const digits = pan.replace(/\D/g, "");
                      if (digits.length >= 4) {
                        setBrandHint(formatCardBrandHint(digits));
                      } else {
                        setBrandHint(null);
                      }
                    }}
                  />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field>
                    <FieldLabel htmlFor="checkout-exp-month">{t.expiryMonth}</FieldLabel>
                    <Input
                      id="checkout-exp-month"
                      type="text"
                      inputMode="numeric"
                      autoComplete="cc-exp-month"
                      dir="ltr"
                      maxLength={2}
                      pattern="0?[1-9]|1[0-2]"
                      title="Month, 01 to 12"
                      placeholder="MM"
                      required
                      className="h-11 font-mono"
                      value={expiry.month}
                      onChange={(e) => setExpiry({ ...expiry, month: e.target.value.replace(/\D/g, "") })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="checkout-exp-year">{t.expiryYear}</FieldLabel>
                    <Input
                      id="checkout-exp-year"
                      type="text"
                      inputMode="numeric"
                      autoComplete="cc-exp-year"
                      dir="ltr"
                      maxLength={4}
                      pattern="\d{4}"
                      title="Four digits, for example 2028"
                      placeholder="YYYY"
                      required
                      className="h-11 font-mono"
                      value={expiry.year}
                      onChange={(e) => setExpiry({ ...expiry, year: e.target.value.replace(/\D/g, "") })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="checkout-cvv">{t.cvv}</FieldLabel>
                    <Input
                      id="checkout-cvv"
                      type="text"
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      dir="ltr"
                      required
                      maxLength={4}
                      placeholder="123"
                      className="h-11 font-mono"
                      value={card.cvv}
                      onChange={(e) => setCard({ ...card, cvv: e.target.value })}
                    />
                  </Field>
                </div>
              </fieldset>
              <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                {submitting ? (
                  <>
                    <Spinner /> {t.processing}
                  </>
                ) : (
                  <>
                    <LockKeyhole aria-hidden="true" />
                    {t.payNow(formatCheckoutAmount(link.amountFils, lang, link.currency))}
                  </>
                )}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <div className="text-center text-xs leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground/80">{t.testCardsTitle}</p>
        <p>
          {([["4000 0000 0000 0002", t.testCard0002], ["4000 0000 0000 0119", t.testCard0119], ["4000 0000 0000 0069", t.testCard0069]] as const).map(([ending, text], i) => (
            <span key={ending}>
              {i > 0 ? " · " : null}
              {t.testCardEnding} <code dir="ltr" className="font-mono text-foreground">{ending}</code> {text}
            </span>
          ))}
          {" · "}
          {t.testCardEnding} <code dir="ltr" className="font-mono text-foreground">4242 4242 4242 4242</code> {t.testCardsApprove}
        </p>
      </div>
    </CheckoutShell>
  );
}

const STATUS_TONES = {
  success: "bg-success/10 text-success",
  muted: "bg-muted text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive",
} as const;

/** Non-payable states, in the same card as the success screen (not the dashboard's empty-table style). */
function CheckoutStatusCard({
  icon: Icon,
  tone,
  title,
  description,
  link,
  onRefresh,
}: {
  icon: LucideIcon;
  tone: keyof typeof STATUS_TONES;
  title: string;
  description: string;
  link?: PaymentLinkPublicDto;
  onRefresh?: () => void;
}) {
  const { t } = useCheckoutLang();
  return (
    <Card className="w-full gap-0 py-0">
      <CardContent className="flex flex-col items-center gap-5 px-6 py-8 text-center">
        <span className={`flex size-14 items-center justify-center rounded-full ${STATUS_TONES[tone]}`}>
          <Icon className="size-8" aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-xl font-semibold uppercase tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {link ? (
          <div className="flex flex-col items-center gap-1">
            <p className="text-sm font-medium text-muted-foreground">{link.merchantDisplayName}</p>
            <CheckoutAmount fils={link.amountFils} currency={link.currency} className="text-3xl font-semibold" />
          </div>
        ) : null}
        {onRefresh ? (
          <Button type="button" size="lg" className="w-full" onClick={onRefresh}>
            {t.refresh}
          </Button>
        ) : null}
        <BackHomeButton label={t.backHome} />
      </CardContent>
    </Card>
  );
}

/** UX-70: the way back to the FilsPay home page from any end screen, so nobody needs the browser's back button. */
function BackHomeButton({ label }: { label: string }) {
  return (
    <Button variant="outline" size="lg" className="w-full" render={<Link to="/" />}>
      {label}
    </Button>
  );
}

/** Calm Aurora backdrop, brand mark, and a fade-in column for every checkout state. */
function CheckoutShell({ children }: { children: React.ReactNode }) {
  return (
    <CheckoutLangRoot>
      <PublicShell tone="calm">
        {/* ENH-011: brand mark + language toggle on one row */}
        <div className="flex w-full max-w-sm items-center justify-between gap-3">
          <BrandMark />
          <CheckoutLangToggle />
        </div>
        <FadeContent trigger="mount" duration={0.6} className="flex w-full max-w-sm flex-col gap-4">
          {children}
        </FadeContent>
      </PublicShell>
    </CheckoutLangRoot>
  );
}
