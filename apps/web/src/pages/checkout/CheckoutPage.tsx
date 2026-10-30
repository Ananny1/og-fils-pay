import { Ban, CheckCircle2, Clock, CreditCard, Hourglass, LockKeyhole, SearchX, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getPaymentLink, payPaymentLink } from "../../api/paymentLinks.js";
import { ApiError } from "../../api/client.js";
import { dateTime } from "../../format.js";
import { formatCardBrandHint } from "../../utils/helpers.js";
import type { PaymentLinkPublicDto, PayPaymentLinkResponse, SimulatedCardInput } from "../../types.js";
import BlurText from "@/components/ui/BlurText";
import FadeContent from "@/components/ui/FadeContent";
import { CopyButton } from "@/components/dashboard/copy-button";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { formatMoney, Money } from "@/components/dashboard/money";
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
  | { kind: "declined"; message: string; retryable: boolean }
  | { kind: "terminal"; message: string };

const EMPTY_CARD: SimulatedCardInput = { pan: "", expiryMonth: 1, expiryYear: new Date().getFullYear() + 1, cvv: "" };

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
          const stageLabel = body.stage === "capture" ? "Your payment could not be completed." : "Your card was declined.";
          setPayState({ kind: "declined", message: stageLabel, retryable: true });
        } else if (statusCode === 502) {
          setPayState({ kind: "declined", message: "The acquirer is temporarily unavailable. Please try again.", retryable: true });
        } else if (statusCode === 409 && body.error === "payment_link_already_paid") {
          setPayState({ kind: "terminal", message: "This has already been paid. Nothing more to do." });
        } else if (statusCode === 409 && body.error === "payment_link_canceled") {
          setPayState({ kind: "terminal", message: "This link isn't available any more." });
        } else if (statusCode === 409) {
          setPayState({ kind: "declined", message: "A payment is already being processed for this link. Please try again shortly.", retryable: true });
        } else if (statusCode === 410) {
          setPayState({ kind: "terminal", message: "This link has expired. Ask the shop to send a new one." });
        } else {
          setPayState({ kind: "declined", message: body.message ?? "Something went wrong. Please try again.", retryable: true });
        }
      } else {
        setPayState({ kind: "declined", message: "Something went wrong. Please try again.", retryable: true });
      }
    }
  }

  if (loadState.kind === "loading") {
    return (
      <CheckoutShell>
        <Card className="w-full gap-0 py-0" aria-busy="true">
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
          title="Payment link not found"
          description="This link doesn't exist. Check you have the full address."
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
              <h1 className="font-heading text-xl font-semibold tracking-tight">Payment successful</h1>
              <p className="text-sm text-muted-foreground">Thank you — your payment has been received.</p>
            </div>
            <Money fils={result.amountFils} className="text-3xl font-semibold" />
            <dl className="w-full divide-y divide-border rounded-lg border border-border text-left text-sm">
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="shrink-0 text-muted-foreground">Transaction ID</dt>
                <dd className="flex min-w-0 items-center gap-1">
                  <span className="truncate font-mono text-xs">{result.transactionId}</span>
                  <CopyButton value={result.transactionId} label="Copy transaction ID" />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="shrink-0 text-muted-foreground">Paid to</dt>
                <dd className="truncate font-medium">{link.merchantDisplayName}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="shrink-0 text-muted-foreground">Paid at</dt>
                <dd className="font-mono text-xs tabular-nums">{dateTime(result.paidAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </CheckoutShell>
    );
  }

  if (payState.kind === "terminal") {
    return (
      <CheckoutShell>
        <CheckoutStatusCard icon={Ban} tone="destructive" title="Unable to pay" description={payState.message} />
      </CheckoutShell>
    );
  }

  if (link.status === "paid") {
    return (
      <CheckoutShell>
        <CheckoutStatusCard
          icon={CheckCircle2}
          tone="success"
          title="Already paid"
          description="This has already been paid. Nothing more to do."
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
          title="Link expired"
          description="This link has expired. Ask the shop to send a new one."
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
          title="No longer available"
          description="This link isn't available any more."
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
          title="Payment processing"
          description="Someone is paying this link right now. Wait a moment, then refresh."
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
          <BlurText
            text={link.merchantDisplayName}
            trigger="load"
            animateBy="words"
            delay={60}
            stepDuration={0.3}
            className="justify-center text-sm font-medium text-muted-foreground"
          />
          <Money fils={link.amountFils} currency={link.currency} className="text-4xl font-semibold tracking-tight" />
          {link.description ? <p className="text-sm text-foreground">{link.description}</p> : null}
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
            {link.reference ? (
              <Badge variant="outline" className="font-mono">
                {link.reference}
              </Badge>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden="true" />
              Expires {dateTime(link.expiresAt)}
            </span>
          </div>
        </div>

        <CardContent className="flex flex-col gap-4 py-6">
          {payState.kind === "declined" ? (
            <ErrorAlert message={payState.message} title="Payment not completed" />
          ) : null}

          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="checkout-pan">Card number</FieldLabel>
                  {showBrand ? (
                    <Badge variant="secondary" className="uppercase tracking-wide">
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
                  <FieldLabel htmlFor="checkout-exp-month">Month</FieldLabel>
                  <Input
                    id="checkout-exp-month"
                    type="text"
                    inputMode="numeric"
                    autoComplete="cc-exp-month"
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
                  <FieldLabel htmlFor="checkout-exp-year">Year</FieldLabel>
                  <Input
                    id="checkout-exp-year"
                    type="text"
                    inputMode="numeric"
                    autoComplete="cc-exp-year"
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
                  <FieldLabel htmlFor="checkout-cvv">CVV</FieldLabel>
                  <Input
                    id="checkout-cvv"
                    type="text"
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    required
                    maxLength={4}
                    placeholder="123"
                    className="h-11 font-mono"
                    value={card.cvv}
                    onChange={(e) => setCard({ ...card, cvv: e.target.value })}
                  />
                </Field>
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                {submitting ? (
                  <>
                    <Spinner /> Processing...
                  </>
                ) : (
                  <>
                    <LockKeyhole aria-hidden="true" />
                    Pay {formatMoney(link.amountFils)} {link.currency}
                  </>
                )}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        Test cards (simulated acquirer, no real charge): any other number approves; a PAN ending{" "}
        <code className="font-mono text-foreground">0002</code> always declines (do not honor); ending{" "}
        <code className="font-mono text-foreground">0119</code> always declines (insufficient funds); ending{" "}
        <code className="font-mono text-foreground">0069</code> always errors.
      </p>
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
}: {
  icon: LucideIcon;
  tone: keyof typeof STATUS_TONES;
  title: string;
  description: string;
  link?: PaymentLinkPublicDto;
}) {
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
            <Money fils={link.amountFils} currency={link.currency} className="text-3xl font-semibold" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Calm Aurora backdrop, brand mark, and a fade-in column for every checkout state. */
function CheckoutShell({ children }: { children: React.ReactNode }) {
  return (
    <PublicShell tone="calm">
      <BrandMark />
      <FadeContent trigger="mount" duration={0.6} className="flex w-full max-w-sm flex-col gap-4">
        {children}
      </FadeContent>
    </PublicShell>
  );
}
