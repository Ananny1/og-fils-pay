import { ArrowLeft, ArrowRight, KeyRound, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { createWebhookEndpoint } from "../../api/webhooks.js";
import { describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import FadeContent from "@/components/ui/FadeContent";
import ShinyText from "@/components/ui/ShinyText";
import { CopyButton } from "@/components/dashboard/copy-button";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { dateTime } from "../../format.js";
import type { WebhookEndpointCreateResponse } from "../../types.js";

/** ShinyText paints through a canvas, which cannot resolve `var(--x)`, so
 *  the theme tokens are read once from the root element instead. Falls back
 *  to a flat `currentColor` fill (no shine) if the token is unavailable. */
function themeColor(token: string): string {
  if (typeof document === "undefined") return "currentColor";
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || "currentColor";
}

/**
 * `POST /v1/merchants/:merchantId/webhook-endpoints`.
 *
 * The `201` response is the only time the signing secret is ever returned —
 * it is stored encrypted at rest (not hashed, because each delivery's HMAC
 * needs the plaintext back) and no read endpoint returns it again. So this
 * page never navigates away on its own: the merchant has to acknowledge the
 * secret panel, which is what stops an accidental redirect or back-button
 * from losing a credential that cannot be re-issued.
 */
export function WebhookEndpointCreatePage() {
  const { me } = useDashboardAuth();
  const navigate = useNavigate();

  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<WebhookEndpointCreateResponse | null>(null);

  /** The response carries the secret; this is the only time it is shown. */
  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!me) return;
    setSubmitting(true);
    setError(null);
    try {
      setCreated(await createWebhookEndpoint(me.merchant.id, { url: url.trim() }));
      toast.success("Webhook endpoint created");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // MK: secret is shown once only
  if (created) {
    return <SecretPanel created={created} onContinue={() => navigate(`/dashboard/webhooks/${created.id}`, { replace: true })} />;
  }

  return (
    <>
      <PageHeader
        title="New webhook endpoint"
        description="We'll send a signed message to this address each time a payment or payout happens."
        actions={
          <Button variant="outline" render={<Link to="/dashboard/webhooks" />}>
            <ArrowLeft data-icon="inline-start" />
            Back to endpoints
          </Button>
        }
      />

      <FadeContent trigger="mount" duration={0.5}>
        <Card className="max-w-xl">
          <form onSubmit={(e) => void handleSubmit(e)}>
            <CardHeader>
              <CardTitle className="case-label">Endpoint</CardTitle>
              <CardDescription>
                A signing secret is generated on create and shown to you exactly once.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <FieldGroup>
                <ErrorAlert message={error} title="Could not create the endpoint" />
                <Field>
                  <FieldLabel htmlFor="wh-url">Endpoint URL</FieldLabel>
                  <Input
                    id="wh-url"
                    type="url"
                    required
                    autoFocus
                    placeholder="https://example.com/filspay/webhooks"
                    className="font-mono"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <FieldDescription>
                    Must be reachable over HTTPS. Respond with a 2xx within a few seconds; anything
                    else is retried with backoff.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end gap-2 pt-6">
              <Button type="button" variant="outline" render={<Link to="/dashboard/webhooks" />}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Spinner data-icon="inline-start" /> : null}
                {submitting ? "Creating…" : "Create endpoint"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </FadeContent>
    </>
  );
}

function SecretPanel({
  created,
  onContinue,
}: {
  created: WebhookEndpointCreateResponse;
  onContinue: () => void;
}) {
  const shine = useMemo(
    () => ({ color: themeColor("--muted-foreground"), shineColor: themeColor("--foreground") }),
    [],
  );

  return (
    <>
      <PageHeader
        title="Endpoint created"
        description={<span className="break-all font-mono text-xs">{created.url}</span>}
        actions={<StatusBadge status={created.status} />}
      />

      <FadeContent trigger="mount" duration={0.5} className="flex max-w-2xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <KeyRound className="size-4" />
              <ShinyText
                text="Signing secret — shown once"
                color={shine.color}
                shineColor={shine.shineColor}
                speed={3}
                className="text-xs font-medium uppercase tracking-wide"
              />
            </CardDescription>
            <CardTitle className="case-label">Store this secret now</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Alert>
              <TriangleAlert className="text-warning" />
              <AlertTitle>This will not be shown again</AlertTitle>
              <AlertDescription>
                Every delivery to this endpoint is signed with it, and it cannot be re-read or
                recovered. If you lose it, delete the endpoint and create a new one.
              </AlertDescription>
            </Alert>

            <div className="flex items-center gap-2">
              <Input
                readOnly
                aria-label="Signing secret"
                value={created.secret}
                className="min-w-0 flex-1 font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <CopyButton value={created.secret} label="Copy signing secret" />
            </div>

            <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Secret prefix
                </dt>
                <dd className="font-mono">{created.secretPrefix}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </dt>
                <dd>
                  <StatusBadge status={created.status} />
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Created
                </dt>
                <dd>{dateTime(created.createdAt)}</dd>
              </div>
            </dl>
          </CardContent>
          <CardFooter className="justify-end pt-6">
            <Button onClick={onContinue}>
              I&apos;ve saved it — continue
              <ArrowRight data-icon="inline-end" />
            </Button>
          </CardFooter>
        </Card>
      </FadeContent>
    </>
  );
}
