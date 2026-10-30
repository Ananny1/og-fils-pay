import { ArrowRight, Info } from "lucide-react";
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, resendOtp, verifyOtp } from "../../api/dashboardAuth.js";
import { ApiError, describeError } from "../../api/client.js";
import {
  readLastMerchantId,
  useDashboardAuth,
  writeLastMerchantId,
} from "../../auth/DashboardAuthContext.js";
import type { DashboardLoginResponse } from "../../types.js";
import AnimatedContent from "@/components/ui/AnimatedContent";
import BlurText from "@/components/ui/BlurText";
import FadeContent from "@/components/ui/FadeContent";
import GradientText from "@/components/ui/GradientText";
import Magnet from "@/components/ui/Magnet";
import StarBorder from "@/components/ui/StarBorder";
import { BatchPreview } from "@/components/dashboard/batch-preview";
import { BotIcon } from "@/components/dashboard/bot-icon";
import { CaseDossier } from "@/components/dashboard/case-dossier";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { BrandMark } from "@/components/dashboard/public-shell";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type Step = { kind: "credentials" } | { kind: "otp"; challenge: DashboardLoginResponse };

const FACTS = ["AI assistant built in", "1 BD = 1000 fils", "Closes 00:00 Bahrain", "Visa · Mastercard"];

const STEPS = [
  {
    title: "Send a link",
    body: "Type the amount in dinars, three decimals and all. Share the link on WhatsApp, by email, or print the QR for the counter.",
  },
  {
    title: "Customer taps pay",
    body: "Card, 3-D Secure, done. The capture shows up in your Transactions list before the customer has put their phone away.",
  },
  {
    title: "Midnight, Bahrain",
    body: "Every capture from the day rolls into one batch: gross, our fee, your net. Integer fils, banker's rounding, nothing lost in the gap.",
  },
  {
    title: "Money in the bank",
    body: "The net lands in your account. A signed settlement.paid webhook tells your own system the same second.",
  },
];

/**
 * Two-step merchant login: merchantId + email + password
 * creates a *pending* session and issues an OTP challenge; the OTP step is
 * what actually authenticates it. Neither step is told which credential was
 * wrong — the API answers a single generic `invalid_credentials`, and this
 * screen repeats it verbatim rather than guessing at something more specific.
 *
 * The Merchant ID field is a raw pasted UUID: `merchant_users.email` is
 * unique per merchant rather than globally, so an email alone cannot identify
 * a user. `localStorage` remembering the last-used value is the whole
 * mitigation available without new backend work.
 */
export function LoginPage() {
  const { status, refresh } = useDashboardAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState<Step>({ kind: "credentials" });
  // MK: remembers the last merchantId in localStorage. not a secret
  const [merchantId, setMerchantId] = useState(() => readLastMerchantId());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/dashboard/transactions";

  if (status === "authenticated") {
    return <Navigate to={redirectTo} replace />;
  }

  function backToCredentials(message: string | null): void {
    setStep({ kind: "credentials" });
    setCode("");
    setError(message);
  }

  async function handleCredentials(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const challenge = await login({ merchantId: merchantId.trim(), email, password });
      setStep({ kind: "otp", challenge });
      setPassword("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // after otp we get logged out after ~10 min. cookie ttl never extended? — am
  // MK: that's the idle timeout, by design
  async function handleOtp(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await verifyOtp({ code });
      writeLastMerchantId(merchantId.trim());
      // The session cookie is now authenticated server-side; re-read `me` so
      // the rest of the dashboard renders from the server's answer, not from
      // the verify response we happen to be holding.
      await refresh();
      navigate(redirectTo, { replace: true });
    } catch (err) {
      // `429 too_many_attempts` revokes the pending session server-side, so
      // retrying the OTP step against it can only ever fail again — start
      // over instead of leaving the user tapping a dead form.
      if (err instanceof ApiError && err.statusCode === 429 && err.code === "too_many_attempts") {
        backToCredentials(describeError(err));
      } else {
        setError(describeError(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend(): Promise<void> {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const challenge = await resendOtp();
      setStep({ kind: "otp", challenge });
      setCode("");
      setNotice("A new code has been sent.");
    } catch (err) {
      // Includes `429 resend_too_soon` — the server owns the cadence rule, so
      // whatever it says is shown as-is rather than pre-empted by a
      // client-side timer that could drift from it.
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const isOtp = step.kind === "otp";

  return (
    <div className="min-h-svh bg-card text-foreground">
      <header className="dark sticky top-0 z-20 border-b-2 border-b-[#c8102e] bg-[var(--bg-header)] text-[var(--on-dark)]">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 md:px-6">
          <BrandMark />
          <div className="flex items-center gap-2">
            <a
              href="#how-it-works"
              className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline"
            >
              How it works
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 md:px-6">
        {/* Hero + sign-in */}
        <section className="grid items-start gap-10 py-10 md:py-16 lg:grid-cols-[1.1fr_minmax(22rem,26rem)] lg:gap-16">
          <div className="space-y-7">
            <FadeContent trigger="mount" duration={0.5}>
              <span className="flex flex-wrap items-center gap-3">
                <span className="case-stamp text-[11px]">Confidential</span>
                <span className="case-label min-w-48 flex-1">AI-powered merchant dashboard</span>
              </span>
            </FadeContent>

            <h1 className="font-heading text-5xl font-bold uppercase leading-[0.98] tracking-[-0.01em] md:text-7xl">
              <BlurText
                text="Card payments for Bahrain,"
                trigger="load"
                animateBy="words"
                delay={70}
                stepDuration={0.35}
                className="block"
              />
              <GradientText
                colors={["#c8102e", "#8f0b21", "#c8102e"]}
                animationSpeed={6}
                className="inline-block"
              >
                settled to the fil.
              </GradientText>
            </h1>

            <FadeContent trigger="mount" duration={0.6} delay={0.25}>
              <p className="max-w-xl text-lg leading-8 text-muted-foreground">
                Your captures, your fees and tonight&apos;s payout, all in one place, with an AI assistant
                that reads your numbers and explains them in plain words. The books close at midnight
                Bahrain time and what you see here is what reaches your bank.
              </p>
            </FadeContent>

            <FadeContent trigger="mount" duration={0.6} delay={0.4}>
              <ul className="flex flex-wrap gap-2">
                {FACTS.map((f) => (
                  <li
                    key={f}
                    className="border border-[var(--card-border)] bg-transparent px-3 py-1 font-mono text-[12px] uppercase tracking-[0.1em] text-foreground"
                  >
                    {f}
                  </li>
                ))}
              </ul>
            </FadeContent>

            <FadeContent trigger="mount" duration={0.7} delay={0.5}>
              <BatchPreview />
            </FadeContent>
          </div>

          <div className="flex flex-col gap-14 lg:sticky lg:top-24">
          <FadeContent trigger="mount" duration={0.7} delay={0.15}>
              <Card className="w-full rounded-2xl border-border/70 shadow-elegant">
                <CardHeader>
                  <CardTitle className="font-heading text-2xl font-bold uppercase">{isOtp ? "Check your inbox" : "Sign in"}</CardTitle>
                  <CardDescription>
                    {isOtp ? (
                      <>
                        A one-time code was issued for{" "}
                        <span className="font-medium text-foreground">{email}</span>. It expires at{" "}
                        <span className="font-mono tabular-nums text-foreground">
                          {new Date(step.challenge.otpExpiresAt).toLocaleTimeString()}
                        </span>
                        .
                      </>
                    ) : (
                      <>
                        Merchant ID, email and password. A one-time code finishes it.
                        <span className="case-note mt-1 block -rotate-1">for authorised merchants only</span>
                      </>
                    )}
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex flex-col gap-4">
                  <ErrorAlert message={error} title="Sign-in failed" />
                  {notice ? (
                    <Alert>
                      <Info className="text-info" />
                      <AlertDescription>{notice}</AlertDescription>
                    </Alert>
                  ) : null}

                  {step.kind === "credentials" ? (
                    <form onSubmit={(e) => void handleCredentials(e)}>
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor="login-merchant-id">Merchant ID</FieldLabel>
                          <Input
                            id="login-merchant-id"
                            type="text"
                            required
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="00000000-0000-0000-0000-000000000000"
                            className="h-11 font-mono text-[13px]"
                            value={merchantId}
                            onChange={(e) => setMerchantId(e.target.value)}
                          />
                          <FieldDescription>From your onboarding email. We remember it on this device.</FieldDescription>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="login-email">Email</FieldLabel>
                          <Input
                            id="login-email"
                            type="email"
                            autoComplete="username"
                            required
                            className="h-11"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="login-password">Password</FieldLabel>
                          <Input
                            id="login-password"
                            type="password"
                            autoComplete="current-password"
                            required
                            className="h-11"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                        </Field>
                        <Magnet padding={40} magnetStrength={14} wrapperClassName="block w-full" innerClassName="block w-full">
                          <Button type="submit" size="lg" className="group w-full" disabled={submitting}>
                            {submitting ? (
                              <>
                                <Spinner /> Signing in...
                              </>
                            ) : (
                              <>
                                Continue{" "}
                                <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
                              </>
                            )}
                          </Button>
                        </Magnet>
                        <Button type="button" variant="outline" size="lg" className="w-full" render={<a href="#how-it-works" />}>
                          How does it work?
                        </Button>
                      </FieldGroup>
                    </form>
                  ) : (
                    <form onSubmit={(e) => void handleOtp(e)}>
                      <FieldGroup>
                        {step.challenge.devOtpCode ? (
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                            <span>
                              Development code:{" "}
                              <code className="font-mono text-sm font-medium tracking-widest text-foreground">
                                {step.challenge.devOtpCode}
                              </code>
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              disabled={submitting}
                              onClick={() => setCode(step.challenge.devOtpCode ?? "")}
                            >
                              Use this code
                            </Button>
                          </div>
                        ) : null}
                        <Field>
                          <FieldLabel htmlFor="login-otp">One-time code</FieldLabel>
                          <Input
                            id="login-otp"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            autoFocus
                            required
                            maxLength={6}
                            placeholder="••••••"
                            className="h-12 text-center font-mono text-2xl tracking-[0.5em] placeholder:tracking-[0.5em]"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                          />
                        </Field>
                        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                          {submitting ? (
                            <>
                              <Spinner /> Verifying...
                            </>
                          ) : (
                            "Verify"
                          )}
                        </Button>
                        <div className="flex items-center justify-between">
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="px-0 text-muted-foreground"
                            disabled={submitting}
                            onClick={() => backToCredentials(null)}
                          >
                            Back
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={submitting}
                            onClick={() => void handleResend()}
                          >
                            Resend code
                          </Button>
                        </div>
                      </FieldGroup>
                    </form>
                  )}
                </CardContent>
              </Card>
          </FadeContent>
            <FadeContent trigger="mount" duration={0.8} delay={0.35} className="hidden justify-center pt-6 md:flex">
              <CaseDossier />
            </FadeContent>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-20 border-t border-border/60 py-14 md:py-20">
          <AnimatedContent distance={40} duration={0.7} threshold={0.2}>
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">From a link to your bank, in four moves</h2>
              <p className="mt-3 text-lg text-muted-foreground">
                No terminal to rent, nothing to install. Each move shows up in the dashboard as it happens.
              </p>
            </div>
          </AnimatedContent>
          <ol className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <AnimatedContent key={s.title} distance={60} duration={0.7} delay={i * 0.12} threshold={0.15}>
                <li className="h-full">
                    <div className="flex h-full flex-col border border-[var(--card-border)] bg-card p-6">
                      <span className="case-numeral text-6xl">{String(i + 1).padStart(2, "0")}</span>
                      <h3 className="mt-5 text-lg font-bold">{s.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{s.body}</p>
                    </div>
                </li>
              </AnimatedContent>
            ))}
          </ol>
        </section>

        {/* AI assistant */}
        <section className="border-t border-border/60 py-14 md:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <AnimatedContent distance={40} duration={0.7} threshold={0.2}>
              <div className="space-y-5">
                <span className="case-label">Exhibit B · Ask FilsPay</span>
                <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Your numbers, explained by AI</h2>
                <p className="text-lg leading-8 text-muted-foreground">
                  Ask in your own words and get an answer from your live data in seconds. The assistant reads
                  your account only. It can&apos;t move money, and the figures it quotes are the same ones the
                  books use, to the fil.
                </p>
                <ul className="space-y-3 text-[15px]">
                  {[
                    ["Ask anything", "“How much did I sell last week?” “Which payments are only partly taken?”"],
                    ["Every payout explained", "Each daily batch gets a short note: what you sold, the fee, and when it reaches your bank."],
                    ["Books that add up", "Owners and finance can ask whether a month reconciles and see where any gap is."],
                  ].map(([title, body]) => (
                    <li key={title} className="flex gap-3">
                      <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <BotIcon className="size-4" animated={false} />
                      </span>
                      <span>
                        <span className="font-semibold">{title}.</span>{" "}
                        <span className="text-muted-foreground">{body}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </AnimatedContent>

            <AnimatedContent distance={60} duration={0.8} delay={0.1} threshold={0.2}>
              <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-elegant">
                <div className="flex items-center gap-2.5 border-b pb-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <BotIcon className="size-6" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">Ask FilsPay</p>
                    <p className="text-xs text-muted-foreground">Reads your account · can&apos;t change anything</p>
                  </div>
                </div>
                <div className="space-y-4 pt-4 text-sm">
                  <div className="flex justify-end">
                    <p className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-primary-foreground">
                      What will tonight&apos;s payout be?
                    </p>
                  </div>
                  <div className="flex gap-2.5">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <BotIcon className="size-[18px]" animated={false} />
                    </span>
                    <div className="space-y-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/60 px-2.5 py-0.5 text-xs text-muted-foreground">
                        <span className="size-1.5 rounded-full bg-success" />
                        Checking settlement batches
                      </span>
                      <p className="leading-6">
                        Today you&apos;ve sold <span className="font-mono">175.134 BHD</span> across 4 payments. After
                        the 2.25% fee of <span className="font-mono">3.941 BHD</span>, about{" "}
                        <span className="font-mono font-semibold">171.193 BHD</span> goes to your bank after midnight.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </AnimatedContent>
          </div>
        </section>

        {/* Closing */}
        <section className="pb-16">
          <AnimatedContent distance={40} duration={0.7} threshold={0.2}>
            <div className="rounded-3xl bg-primary/[0.06] px-6 py-12 text-center ring-1 ring-primary/15 md:px-12">
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Already with FilsPay?</h2>
              <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
                Sign in above. Not a merchant yet? Our onboarding takes a licence, an ID and one working day.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <StarBorder
                  as="a"
                  href="#login-merchant-id"
                  color="hsl(4 90% 55%)"
                  trailColor="hsl(220 55% 35%)"
                  duration={5}
                  thickness={1}
                  radius={12}
                  glow={0.5}
                  theme="light"
                  backgroundColor="hsl(4 90% 55%)"
                  textColor="#fff"
                  className="inline-flex h-11 items-center gap-2 px-6 text-[15px] font-medium"
                >
                  Go to sign in <ArrowRight className="size-4" />
                </StarBorder>
                <Button size="lg" variant="outline" render={<a href="mailto:support@filspay.example" />}>
                  Talk to onboarding
                </Button>
              </div>
            </div>
          </AnimatedContent>
        </section>
      </main>

      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-muted-foreground md:flex-row md:px-6">
          <BrandMark className="opacity-80" />
          <p>© 2026 FilsPay · Manama, Kingdom of Bahrain</p>
        </div>
      </footer>
    </div>
  );
}
