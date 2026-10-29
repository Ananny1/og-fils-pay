import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Ban,
  Banknote,
  Hourglass,
  ListOrdered,
  SearchX,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  captureTransaction,
  getTransaction,
  getTransactionEvents,
  voidTransaction,
} from "../../api/transactions.js";
import { ApiError, describeError } from "../../api/client.js";
import { RequireRole } from "../../auth/RequireRole.js";
import FadeContent from "@/components/FadeContent";
import { CopyButton } from "@/components/dashboard/copy-button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { Money } from "@/components/dashboard/money";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { StatCard } from "@/components/dashboard/stat-card";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { dash, dateTime } from "../../format.js";
import { truncateMiddle } from "../../utils/helpers.js";
import type { TransactionDto, TransactionEventDto } from "../../types.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; txn: TransactionDto };

/** Icon + tone for a timeline entry, keyed loosely on the event type string
 *  so a new server-side event type still renders (as a generic activity
 *  dot) rather than breaking the page. */
function eventLook(eventType: string): { icon: LucideIcon; tone: string } {
  const t = eventType.toLowerCase();
  if (t.includes("chargeback")) {
    return { icon: AlertTriangle, tone: "border-destructive/25 bg-destructive/10 text-destructive" };
  }
  if (t.includes("refund")) return { icon: Undo2, tone: "border-info/25 bg-info/12 text-info" };
  if (t.includes("void")) return { icon: Ban, tone: "border-destructive/25 bg-destructive/10 text-destructive" };
  if (t.includes("captur")) return { icon: Banknote, tone: "border-success/25 bg-success/12 text-success" };
  if (t.includes("auth")) return { icon: ShieldCheck, tone: "border-warning/30 bg-warning/15 text-warning" };
  return { icon: Activity, tone: "border-border bg-muted text-muted-foreground" };
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function MonoWithCopy({ value, label, truncate }: { value: string; label: string; truncate?: number }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className="font-mono text-xs break-all" title={value}>
        {truncate ? truncateMiddle(value, truncate) : value}
      </span>
      <CopyButton value={value} label={label} />
    </span>
  );
}

function BackButton() {
  return (
    <Button variant="outline" render={<Link to="/dashboard/transactions" />}>
      <ArrowLeft />
      Back to transactions
    </Button>
  );
}

/**
 * `GET /v1/transactions/:id` plus its event timeline on the same page — one
 * feature, so one view, not two navigable routes.
 *
 * A `404` renders a plain "not found" state and never tries to distinguish
 * "doesn't exist" from "not yours": the API deliberately answers the same way
 * for both (a `403` would confirm a foreign transaction's existence), and
 * this page does not undo that by guessing.
 */
// MK: timeline renders refund events fine
// FH: RefundDrawer import removed 2026-06 until the route exists
export function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [events, setEvents] = useState<TransactionEventDto[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureAmount, setCaptureAmount] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setState({ kind: "not_found" });
      return;
    }
    try {
      // Two independent reads — the events route does its own merchant-scoped
      // existence check, so neither depends on the other's result.
      const [txn, timeline] = await Promise.all([getTransaction(id), getTransactionEvents(id)]);
      setState({ kind: "loaded", txn });
      setEvents(timeline);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        setState({ kind: "not_found" });
      } else {
        setState({ kind: "error", message: describeError(err) });
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCapture(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!id) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const trimmed = captureAmount.trim();
      // Left blank, `amountFils` is omitted entirely and capture.ts captures
      // everything still outstanding — its own documented default. Computing
      // the remainder here would just be a second, staler copy of that rule.
      const input = trimmed === "" ? {} : { amountFils: Number(trimmed) };
      // A fresh Idempotency-Key per click, including a retry after a decline —
      // same discipline as the checkout page's submit handler.
      await captureTransaction(id, input, crypto.randomUUID());
      setCaptureOpen(false);
      setCaptureAmount("");
      toast.success("Capture submitted");
      // Refetch rather than patch: a capture wrote a new transaction_events
      // row server-side, so the timeline is stale, not merely shorter.
      await load();
    } catch (err) {
      const message = describeError(err);
      setActionError(message);
      toast.error("Capture failed", { description: message });
    } finally {
      setSubmitting(false);
    }
  }

  /** Only offered while status is authorized. Confirmation happens in the
   *  AlertDialog that calls this, so by the time we are here the user has
   *  already said yes. */
  async function handleVoid(): Promise<void> {
    if (!id) return;
    setSubmitting(true);
    setActionError(null);
    try {
      // An already-voided transaction also answers `200` with the voided row —
      // indistinguishable from a first void on the wire, and correctly so:
      // both mean "now voided".
      await voidTransaction(id);
      toast.success("Authorization voided");
      await load();
    } catch (err) {
      const message = describeError(err);
      setActionError(message);
      toast.error("Void failed", { description: message });
    } finally {
      setSubmitting(false);
      setVoidOpen(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <>
        <PageHeader title="Transaction" description="Loading…" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Authorized" loading />
          <StatCard label="Captured" loading />
          <StatCard label="Remaining to capture" loading />
          <StatCard label="Events" loading />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <SectionCard title="Event timeline" className="lg:col-span-2">
            <div className="flex flex-col gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Details">
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          </SectionCard>
        </div>
      </>
    );
  }
  if (state.kind === "not_found") {
    return (
      <>
        <PageHeader title="Transaction not found" />
        <EmptyState
          icon={SearchX}
          title="No transaction with this id"
          description="No transaction with this id exists on your account."
          action={<BackButton />}
        />
      </>
    );
  }
  if (state.kind === "error") {
    return (
      <>
        <PageHeader title="Transaction" actions={<BackButton />} />
        <ErrorAlert message={state.message} title="Couldn't load this transaction" />
      </>
    );
  }

  const { txn } = state;
  const capturable = txn.status === "authorized" || txn.status === "partially_captured";
  const voidable = txn.status === "authorized";
  // Display-only: the server's own remainder rule is what capture.ts applies
  // when `amountFils` is omitted. Nothing is outstanding once the transaction
  // can no longer be captured.
  const remainingFils = capturable ? Math.max(0, txn.amountFils - txn.capturedFils) : 0;

  return (
    <>
      <PageHeader
        title={txn.reference ?? "Transaction"}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={txn.status} />
            <span className="font-mono text-xs">{txn.id}</span>
            <CopyButton value={txn.id} label="Copy transaction id" />
          </span>
        }
        actions={
          <>
            <BackButton />
            {/* Capture and void are hidden from `support` as a UX choice — a support
                agent looks things up, they don't move money. Unlike the
                reconciliation page, this hide is NOT backed by a matching
                server-side role check: the API gates capture/void at "any
                authenticated merchant actor". Do not mistake a hidden button here for a security
                boundary. */}
            <RequireRole allow={["owner", "finance"]}>
              {capturable ? (
                <Button disabled={submitting} onClick={() => setCaptureOpen(true)}>
                  <Banknote />
                  Capture
                </Button>
              ) : null}
              {voidable ? (
                <Button variant="destructive" disabled={submitting} onClick={() => setVoidOpen(true)}>
                  <Ban />
                  Void
                </Button>
              ) : null}
            </RequireRole>
          </>
        }
      />

      <ErrorAlert message={actionError} title="Action failed" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Authorized" fils={txn.amountFils} icon={ShieldCheck} hint={`Occurred ${dateTime(txn.occurredAt)}`} />
        <StatCard label="Captured" fils={txn.capturedFils} icon={Banknote} hint={`Status: ${txn.status.replaceAll("_", " ")}`} />
        <StatCard
          label="Remaining to capture"
          fils={remainingFils}
          icon={Hourglass}
          hint={capturable ? "Authorized minus captured" : "Nothing outstanding"}
        />
        <StatCard label="Events" count={events.length} icon={ListOrdered} hint="Recorded on the timeline" />
      </div>

      <FadeContent trigger="mount" duration={0.5} initialOpacity={0}>
        <div className="grid gap-6 lg:grid-cols-3">
          <SectionCard
            title="Event timeline"
            description="Oldest first, exactly as the API recorded it."
            className="lg:col-span-2"
          >
            {events.length === 0 ? (
              <EmptyState icon={Activity} title="No events recorded" />
            ) : (
              <ol className="flex flex-col">
                {/* Already ordered oldest-first by the endpoint — never re-sorted
                    here, so the page can't disagree with the API about history. */}
                {events.map((event, index) => {
                  const { icon: Icon, tone } = eventLook(event.eventType);
                  const last = index === events.length - 1;
                  return (
                    <li key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
                      {!last ? (
                        <span
                          aria-hidden
                          className="absolute top-8 bottom-0 left-4 w-px -translate-x-1/2 bg-border"
                        />
                      ) : null}
                      <span
                        className={cn(
                          "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border",
                          tone,
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                          <p className="text-sm font-medium capitalize">{event.eventType.replaceAll("_", " ")}</p>
                          {event.amountFils === null ? (
                            <span className="text-sm text-muted-foreground">—</span>
                          ) : (
                            <Money fils={event.amountFils} className="text-sm" />
                          )}
                        </div>
                        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                          <time dateTime={event.occurredAt}>{dateTime(event.occurredAt)}</time>
                          <span aria-hidden>·</span>
                          <span className="capitalize">{event.actorType.replaceAll("_", " ")}</span>
                          {event.actorId ? (
                            <>
                              <span aria-hidden>·</span>
                              <span className="font-mono" title={event.actorId}>
                                {truncateMiddle(event.actorId, 20)}
                              </span>
                            </>
                          ) : null}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </SectionCard>

          <SectionCard title="Details">
            <dl className="divide-y">
              <DetailRow label="Transaction id">
                <MonoWithCopy value={txn.id} label="Copy transaction id" />
              </DetailRow>
              <DetailRow label="Acquirer reference">
                <MonoWithCopy value={txn.acquirerReference} label="Copy acquirer reference" truncate={28} />
              </DetailRow>
              <DetailRow label="Merchant id">
                <MonoWithCopy value={txn.merchantId} label="Copy merchant id" />
              </DetailRow>
              <DetailRow label="Reference">
                <span className="font-mono text-xs">{dash(txn.reference)}</span>
              </DetailRow>
              <DetailRow label="Currency">{txn.currency}</DetailRow>
              <DetailRow label="Occurred at">
                <time dateTime={txn.occurredAt}>{dateTime(txn.occurredAt)}</time>
              </DetailRow>
              <DetailRow label="Created at">
                <time dateTime={txn.createdAt}>{dateTime(txn.createdAt)}</time>
              </DetailRow>
            </dl>
          </SectionCard>
        </div>
      </FadeContent>

      {/* Capture amount form. Same submit handler and state as before; the
          dialog only replaces the old inline form. */}
      <Dialog
        open={captureOpen}
        onOpenChange={(open) => {
          if (!submitting) setCaptureOpen(open);
        }}
      >
        <DialogContent>
          <form className="flex flex-col gap-4" onSubmit={(e) => void handleCapture(e)}>
            <DialogHeader>
              <DialogTitle>Capture funds</DialogTitle>
              <DialogDescription>
                <Money fils={remainingFils} /> is still authorized and not yet captured on this transaction.
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="capture-amount">Amount in fils</FieldLabel>
              <Input
                id="capture-amount"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                placeholder="Everything outstanding"
                className="font-mono tabular-nums"
                value={captureAmount}
                onChange={(e) => setCaptureAmount(e.target.value)}
                disabled={submitting}
                autoFocus
              />
              <FieldDescription>Leave blank to capture everything still outstanding.</FieldDescription>
              {actionError ? <FieldError>{actionError}</FieldError> : null}
            </Field>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={submitting} />}>Cancel</DialogClose>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Spinner /> : <Banknote />}
                {submitting ? "Capturing…" : "Capture"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Void is destructive and irreversible, so it gets a confirm step. */}
      <AlertDialog
        open={voidOpen}
        onOpenChange={(open) => {
          if (!submitting) setVoidOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Ban />
            </AlertDialogMedia>
            <AlertDialogTitle>Void this authorization?</AlertDialogTitle>
            <AlertDialogDescription>
              The held <Money fils={txn.amountFils} /> is released back to the cardholder and cannot be captured
              afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Keep authorization</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={submitting} onClick={() => void handleVoid()}>
              {submitting ? <Spinner /> : <Ban />}
              {submitting ? "Voiding…" : "Void authorization"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
