import { parseBhdToFils } from "@filspay/money";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { createPaymentLink } from "../../api/paymentLinks.js";
import { describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import FadeContent from "@/components/ui/FadeContent";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { Money } from "@/components/dashboard/money";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { localDateTimeToIso } from "../../format.js";

/**
 * `POST /v1/merchants/:merchantId/payment-links`, `owner`/`finance`
 * server-side.
 *
 * Amount is typed in BHD (up to 3 decimals), like every amount the merchant
 * sees, and turned into integer fils by `parseBhdToFils` from @filspay/money —
 * a string parser, never `parseFloat`. The BHD preview under the field is
 * display only and goes through the same `formatBhd` path as every other amount.
 *
 * The two client-side checks below mirror the server's own two real checks so
 * an obviously-bad value doesn't need a round trip. They are not the
 * validation: `400 invalid_amount` / `400 invalid_expiry` remain the real
 * answer and are rendered verbatim.
 */
/** BHD text → positive integer fils, or null when it is not a valid amount. */
function parseAmountFils(text: string): number | null {
  try {
    const fils = parseBhdToFils(text);
    return fils > 0 ? fils : null;
  } catch {
    return null;
  }
}

const AMOUNT_HINT = "Enter a positive amount in BHD with up to 3 decimals, e.g. 4.750.";

export function PaymentLinkCreatePage() {
  const { me } = useDashboardAuth();
  const navigate = useNavigate();

  const [amountBhd, setAmountBhd] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview only: the submit path below re-derives and re-checks the number.
  const previewFils = amountBhd.trim() === "" ? null : parseAmountFils(amountBhd);
  const amountInvalid = amountBhd.trim() !== "" && previewFils === null;

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!me) return;
    setError(null);

    const amount = parseAmountFils(amountBhd);
    if (amount === null) {
      setError(AMOUNT_HINT);
      return;
    }
    const expiresAtIso = localDateTimeToIso(expiresAt);
    if (!expiresAtIso) {
      setError("Expiry must be a valid date and time.");
      return;
    }
    if (new Date(expiresAtIso).getTime() <= Date.now()) {
      setError("Expiry must be in the future.");
      return;
    }

    setSubmitting(true);
    try {
      const link = await createPaymentLink(me.merchant.id, {
        amountFils: amount,
        reference: reference.trim() || undefined,
        description: description.trim() || undefined,
        expiresAt: expiresAtIso,
      });
      toast.success("Payment link created");
      navigate(`/dashboard/payment-links/${link.id}`, { replace: true });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New payment link"
        description="One link, one amount, one customer. It stops working once it's paid."
        actions={
          <Button variant="outline" render={<Link to="/dashboard/payment-links" />}>
            <ArrowLeft data-icon="inline-start" />
            Back to payment links
          </Button>
        }
      />

      <FadeContent trigger="mount" duration={0.5}>
        <Card className="max-w-xl">
          <form onSubmit={(e) => void handleSubmit(e)}>
            <CardHeader>
              <CardTitle>Link details</CardTitle>
              <CardDescription>
                The customer sees the amount and description on the checkout page.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <FieldGroup>
                <ErrorAlert message={error} title="Could not create the link" />

                <Field data-invalid={amountInvalid || undefined}>
                  <FieldLabel htmlFor="pl-amount">Amount (BHD)</FieldLabel>
                  <Input
                    id="pl-amount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    required
                    placeholder="4.750"
                    className="font-mono"
                    aria-invalid={amountInvalid || undefined}
                    value={amountBhd}
                    onChange={(e) => setAmountBhd(e.target.value)}
                  />
                  {amountInvalid ? (
                    <FieldError>{AMOUNT_HINT}</FieldError>
                  ) : (
                    <FieldDescription>
                      Up to 3 decimals (1 BHD = 1000 fils).
                      {previewFils !== null ? (
                        <>
                          {" "}= <Money fils={previewFils} className="text-foreground" />
                        </>
                      ) : null}
                    </FieldDescription>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="pl-reference">Reference</FieldLabel>
                  <Input
                    id="pl-reference"
                    type="text"
                    placeholder="INV-1042"
                    className="font-mono"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                  <FieldDescription>Optional. Your own identifier, shown in the list.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="pl-description">Description</FieldLabel>
                  <Textarea
                    id="pl-description"
                    rows={3}
                    placeholder="What the customer is paying for"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <FieldDescription>Optional. Shown to the customer at checkout.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="pl-expires">Expires at</FieldLabel>
                  <Input
                    id="pl-expires"
                    type="datetime-local"
                    required
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                  <FieldDescription>Bahrain time. The link stops accepting payment after this.</FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end gap-2 pt-6">
              <Button type="button" variant="outline" render={<Link to="/dashboard/payment-links" />}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Spinner data-icon="inline-start" /> : null}
                {submitting ? "Creating…" : "Create payment link"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </FadeContent>
    </>
  );
}
