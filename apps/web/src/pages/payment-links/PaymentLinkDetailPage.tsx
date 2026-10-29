import { ArrowLeft, Ban, ExternalLink, Link as LinkIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { cancelPaymentLink, listPaymentLinks } from "../../api/paymentLinks.js";
import { describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import { RequireRole } from "../../auth/RequireRole.js";
import FadeContent from "@/components/ui/FadeContent";
import { CopyButton } from "@/components/dashboard/copy-button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { Money } from "@/components/dashboard/money";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { dash, dateTime } from "../../format.js";
import type { PaymentLinkDto } from "../../types.js";

/** The list endpoint's own maximum page size. */
const LOOKUP_LIMIT = 100;

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; link: PaymentLinkDto };

/**
 * There is no merchant-authenticated `GET .../payment-links/:id` — the API
 * has the merchant-scoped *list* and the *public* single-token read, and nothing
 * in between. So this page reads the first page of the unfiltered list
 * (newest-first, capped at the endpoint's own 100-row maximum) and finds the
 * row by id.
 *
 * That is correct for a merchant with a normal number of links and genuinely
 * degrades for one whose direct-linked link has aged past row 100 — it will
 * render "not found" for a link that exists. It is left this way deliberately
 * rather than papered over with cursor-walking loops: the real fix is a
 * one-row backend route (`SELECT * ... WHERE id = $1 AND merchant_id = $2`,
 * 404 on no match).
 */
export function PaymentLinkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useDashboardAuth();
  const merchantId = me?.merchant.id;

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!merchantId || !id) return;
    try {
      const result = await listPaymentLinks(merchantId, { limit: LOOKUP_LIMIT });
      const found = result.paymentLinks.find((link) => link.id === id);
      setState(found ? { kind: "loaded", link: found } : { kind: "not_found" });
    } catch (err) {
      setState({ kind: "error", message: describeError(err) });
    }
  }, [merchantId, id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Confirmed by the AlertDialog below, so no `window.confirm` here. */
  async function handleCancel(): Promise<void> {
    if (!merchantId || !id) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await cancelPaymentLink(merchantId, id);
      toast.success("Payment link canceled");
      await load();
    } catch (err) {
      // Includes `409 not_cancelable` for a link that is paid, already
      // canceled, or `reserved` mid-payment-attempt.
      const message = describeError(err);
      setActionError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  const backButton = (
    <Button variant="ghost" render={<Link to="/dashboard/payment-links" />}>
      <ArrowLeft data-icon="inline-start" />
      Back to payment links
    </Button>
  );

  if (state.kind === "loading") {
    return (
      <>
        <PageHeader title="Payment link" actions={backButton} />
        <Card>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-8 w-full max-w-xl" />
            <div className="grid gap-4 sm:grid-cols-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          </CardContent>
        </Card>
      </>
    );
  }
  if (state.kind === "error") {
    return (
      <>
        <PageHeader title="Payment link" actions={backButton} />
        <ErrorAlert message={state.message} title="Could not load this payment link" />
      </>
    );
  }
  if (state.kind === "not_found") {
    return (
      <>
        <PageHeader title="Payment link" actions={backButton} />
        <EmptyState
          icon={LinkIcon}
          title="Payment link not found"
          description={`This link is not among your ${LOOKUP_LIMIT} most recent payment links.`}
          action={
            <Button variant="outline" render={<Link to="/dashboard/payment-links" />}>
              Back to payment links
            </Button>
          }
        />
      </>
    );
  }

  const { link } = state;

  return (
    <>
      <PageHeader
        title={link.reference ?? "Payment link"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{link.id}</span>
            <StatusBadge status={link.status} />
          </span>
        }
        actions={
          <>
            {backButton}
            {link.status === "active" ? (
              <RequireRole allow={["owner", "finance"]}>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={<Button variant="destructive" disabled={submitting} />}
                  >
                    {submitting ? <Spinner data-icon="inline-start" /> : <Ban data-icon="inline-start" />}
                    {submitting ? "Canceling…" : "Cancel link"}
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogMedia className="bg-destructive/10 text-destructive">
                        <Ban />
                      </AlertDialogMedia>
                      <AlertDialogTitle>Cancel this payment link?</AlertDialogTitle>
                      <AlertDialogDescription>
                        It can no longer be paid. Anyone opening the link will see that it was canceled.
                        This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep link</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => void handleCancel()}>
                        Cancel payment link
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </RequireRole>
            ) : null}
          </>
        }
      />

      <ErrorAlert message={actionError} title="Could not cancel the link" />

      <FadeContent trigger="mount" duration={0.5} className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardDescription>Amount</CardDescription>
            <CardTitle>
              <Money fils={link.amountFils} currency={link.currency} className="text-3xl font-semibold" />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <span className="text-sm font-medium">Checkout link</span>
            {/* Linked to, never duplicated — /pay/:token is the one checkout
                implementation, and there is no preview of it embedded here. */}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                readOnly
                aria-label="Checkout link"
                value={link.url}
                className="min-w-0 flex-1 font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <CopyButton value={link.url} label="Copy checkout link" />
              <Button
                variant="outline"
                size="sm"
                render={<a href={link.url} target="_blank" rel="noreferrer" />}
              >
                <ExternalLink data-icon="inline-start" />
                Open
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Share this URL with the customer. It expires {dateTime(link.expiresAt)}.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Description">{dash(link.description)}</Detail>
              <Detail label="Currency">{link.currency}</Detail>
              <Detail label="Created">{dateTime(link.createdAt)}</Detail>
              <Detail label="Expires">{dateTime(link.expiresAt)}</Detail>
              <Detail label="Paid at">{dateTime(link.paidAt)}</Detail>
              <Detail label="Canceled at">{dateTime(link.canceledAt)}</Detail>
              <Detail label="Transaction">
                {link.transactionId ? (
                  <Link
                    to={`/dashboard/transactions/${link.transactionId}`}
                    className="font-mono text-primary underline-offset-4 hover:underline"
                  >
                    {link.transactionId}
                  </Link>
                ) : (
                  "—"
                )}
              </Detail>
              <Detail label="Token">
                <span className="font-mono">{link.token}</span>
              </Detail>
            </dl>
          </CardContent>
        </Card>
      </FadeContent>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm break-all">{children}</dd>
    </div>
  );
}
