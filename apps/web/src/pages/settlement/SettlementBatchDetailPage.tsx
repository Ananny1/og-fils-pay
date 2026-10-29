import { ArrowLeft, Banknote, FileSearch, Hash, Percent, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getSettlementBatch, getSettlementBatchTransactions } from "../../api/settlement.js";
import { ApiError, describeError } from "../../api/client.js";
import FadeContent from "@/components/ui/FadeContent";
import { CopyButton } from "@/components/dashboard/copy-button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { Money } from "@/components/dashboard/money";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { StatCard } from "@/components/dashboard/stat-card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TableSkeleton } from "@/components/dashboard/table-skeleton";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dash, dateTime } from "../../format.js";
import type { SettlementBatchDetailDto, SettlementBatchTransactionDto } from "../../types.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; batch: SettlementBatchDetailDto };

const LINE_COLUMNS = 7;

function BackButton() {
  return (
    <Button variant="outline" size="sm" render={<Link to="/dashboard/settlement" />}>
      <ArrowLeft />
      All batches
    </Button>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * `GET /v1/settlement/batches/:id` plus its line items.
 *
 * The two counts are rendered as two separately-labeled figures and never
 * added, averaged, or presented as one number: a transaction captured twice
 * inside the batch window contributes one scheme export line but two capture
 * events, so they can legitimately differ. Conflating them would invent a
 * discrepancy where there isn't one — or hide a real one.
 *
 * No pagination on the line items: the endpoint has none, and adding a
 * client-side cap would silently drop rows from a settlement figure.
 */
export function SettlementBatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [lines, setLines] = useState<SettlementBatchTransactionDto[]>([]);

  useEffect(() => {
    if (!id) {
      setState({ kind: "not_found" });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [batch, txns] = await Promise.all([
          getSettlementBatch(id),
          getSettlementBatchTransactions(id),
        ]);
        if (cancelled) return;
        setState({ kind: "loaded", batch });
        setLines(txns.transactions);
      } catch (err) {
        if (cancelled) return;
        // 404, not 403, for another merchant's batch — the same non-disclosure
        // choice the transaction detail read makes.
        if (err instanceof ApiError && err.statusCode === 404) {
          setState({ kind: "not_found" });
        } else {
          setState({ kind: "error", message: describeError(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.kind === "loading") {
    return (
      <>
        <PageHeader title="Settlement batch" description={<Skeleton className="h-4 w-48" />} actions={<BackButton />} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Gross" loading />
          <StatCard label="Fee" loading />
          <StatCard label="Net payout" loading />
          <StatCard label="Transactions" loading />
        </div>
        <SectionCard title="Details">
          <div className="space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </SectionCard>
        <SectionCard flush title="Included transactions">
          <Table>
            <TableSkeleton rows={5} cols={LINE_COLUMNS} />
          </Table>
        </SectionCard>
      </>
    );
  }

  if (state.kind === "not_found") {
    return (
      <>
        <PageHeader title="Settlement batch not found" actions={<BackButton />} />
        <EmptyState
          icon={FileSearch}
          title="No batch with this id"
          description="No settlement batch with this id exists on your account."
          action={
            <Button variant="outline" render={<Link to="/dashboard/settlement" />}>
              <ArrowLeft />
              Back to settlement batches
            </Button>
          }
        />
      </>
    );
  }

  if (state.kind === "error") {
    return (
      <>
        <PageHeader title="Settlement batch" actions={<BackButton />} />
        <ErrorAlert message={state.message} title="Could not load this batch" />
      </>
    );
  }

  const { batch } = state;
  const countsDiffer = batch.includedEventCount !== batch.includedTransactionCount;

  return (
    <>
      <PageHeader
        title={`Settlement batch ${batch.batchDate}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={batch.status} />
            <span>Bahrain business date {batch.batchDate}</span>
          </span>
        }
        actions={<BackButton />}
      />

      <FadeContent trigger="mount" duration={0.5} delay={0.05}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Gross" fils={batch.grossFils} icon={Wallet} hint="Sum of captured amounts in the window" />
          <StatCard label="Fee" fils={batch.feeFils} icon={Percent} hint="Acquirer fee for this batch" />
          <StatCard label="Net payout" fils={batch.netPayoutFils} icon={Banknote} hint="Gross minus fee" />
          <StatCard
            label="Transactions"
            count={batch.includedTransactionCount}
            icon={Hash}
            hint={`${batch.includedEventCount.toLocaleString()} capture ${batch.includedEventCount === 1 ? "event" : "events"} in this batch`}
          />
        </div>
      </FadeContent>

      <FadeContent trigger="mount" duration={0.5} delay={0.12}>
        <SectionCard title="Details" description="Identifiers and lifecycle timestamps for this batch.">
          <dl className="divide-y">
            <DetailRow label="Batch id">
              <span className="inline-flex items-center gap-1">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all">{batch.id}</code>
                <CopyButton value={batch.id} label="Copy batch id" />
              </span>
            </DetailRow>
            <DetailRow label="Batch date">
              <span className="font-mono">{batch.batchDate}</span>
            </DetailRow>
            <DetailRow label="Status">
              <StatusBadge status={batch.status} />
            </DetailRow>
            <DetailRow label="Closed at">{dateTime(batch.closedAt)}</DetailRow>
            <DetailRow label="Paid at">{dateTime(batch.paidAt)}</DetailRow>
            <DetailRow label="Included transactions">
              <span className="font-mono tabular-nums">{batch.includedTransactionCount.toLocaleString()}</span>
            </DetailRow>
            <DetailRow label="Capture events in this batch">
              <span className="font-mono tabular-nums">{batch.includedEventCount.toLocaleString()}</span>
              {countsDiffer ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  More events than transactions is normal: a transaction captured more than once in this window
                  contributes one export line and several events.
                </p>
              ) : null}
            </DetailRow>
          </dl>
        </SectionCard>
      </FadeContent>

      <FadeContent trigger="mount" duration={0.5} delay={0.2}>
        <SectionCard
          flush
          title="Included transactions"
          description="The scheme amount is the card-network export figure, quantized to two decimal places at that boundary — it can be up to 9 fils below the captured amount by design."
        >
          {lines.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No scheme export lines"
                description="This batch has no scheme export lines yet."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-right">Line</TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Authorized</TableHead>
                  <TableHead className="text-right">Captured</TableHead>
                  <TableHead className="text-right">Scheme amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={`${line.transactionId}-${line.lineSequence}`}>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {line.lineSequence}
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/dashboard/transactions/${line.transactionId}`}
                        className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                      >
                        {line.transactionId}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate">{dash(line.reference)}</TableCell>
                    <TableCell>
                      <StatusBadge status={line.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money fils={line.authorizedFils} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money fils={line.capturedFils} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money fils={line.schemeAmountFils} className="font-medium" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </FadeContent>
    </>
  );
}
