import { Banknote, Percent, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listSettlementBatches } from "../../api/settlement.js";
import { describeError } from "../../api/client.js";
import FadeContent from "@/components/ui/FadeContent";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { LoadMoreButton } from "@/components/dashboard/load-more";
import { Money } from "@/components/dashboard/money";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { StatCard } from "@/components/dashboard/stat-card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TableSkeleton } from "@/components/dashboard/table-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { dateTime } from "../../format.js";
import type { SettlementBatchDto, SettlementBatchStatus } from "../../types.js";

const STATUSES: SettlementBatchStatus[] = ["open", "closed", "paid"];
const PAGE_SIZE = 25;

/**
 * `GET /v1/settlement/batches` — `requireMerchantAuth` with no role
 * restriction — a batch list is not as sensitive as the reconciliation
 * report.
 *
 * `from`/`to` bound `batch_date`, a plain DATE column, so the raw YYYY-MM-DD
 * value from the date input goes through unchanged — no instant conversion,
 * because there is no timezone in the column to convert against.
 */
/** Filters by batch_date, which is a Bahrain business date. */
export function SettlementBatchListPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statuses, setStatuses] = useState<SettlementBatchStatus[]>([]);
  const [batches, setBatches] = useState<SettlementBatchDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const result = await listSettlementBatches({
          from: from || undefined,
          to: to || undefined,
          status: statuses.length > 0 ? statuses : undefined,
          limit: PAGE_SIZE,
          cursor: cursor ?? undefined,
        });
        setBatches((previous) => (cursor ? [...previous, ...result.batches] : result.batches));
        setNextCursor(result.nextCursor);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setLoading(false);
      }
    },
    [from, to, statuses],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  function toggleStatus(status: SettlementBatchStatus): void {
    setStatuses((previous) =>
      previous.includes(status) ? previous.filter((s) => s !== status) : [...previous, status],
    );
  }

  // Plain integer additions over fils — never floats, never divided.
  const totals = useMemo(
    () =>
      batches.reduce(
        (acc, batch) => ({
          gross: acc.gross + batch.grossFils,
          fee: acc.fee + batch.feeFils,
          net: acc.net + batch.netPayoutFils,
        }),
        { gross: 0, fee: 0, net: 0 },
      ),
    [batches],
  );

  const hasFilters = from !== "" || to !== "" || statuses.length > 0;
  const initialLoading = loading && batches.length === 0;
  const loadedHint = `${batches.length} ${batches.length === 1 ? "batch" : "batches"} loaded`;

  return (
    <>
      <PageHeader
        title="Settlement batches"
        description="Daily batches of captured transactions keyed on the Bahrain business date. Net payout is always gross minus the acquirer fee."
      />

      <FadeContent trigger="mount" duration={0.5} delay={0.05}>
        <Card>
          <CardContent className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
                {STATUSES.map((status) => {
                  const active = statuses.includes(status);
                  return (
                    <Button
                      key={status}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      aria-pressed={active}
                      className={cn("capitalize", !active && "text-muted-foreground")}
                      onClick={() => toggleStatus(status)}
                    >
                      {status}
                    </Button>
                  );
                })}
              </div>
            </div>
            {hasFilters ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto text-muted-foreground"
                onClick={() => {
                  setFrom("");
                  setTo("");
                  setStatuses([]);
                }}
              >
                <X />
                Clear filters
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </FadeContent>

      <FadeContent trigger="mount" duration={0.5} delay={0.12}>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total gross" fils={totals.gross} icon={Wallet} loading={initialLoading} hint={loadedHint} />
          <StatCard label="Total fees" fils={totals.fee} icon={Percent} loading={initialLoading} hint={loadedHint} />
          <StatCard label="Total net payout" fils={totals.net} icon={Banknote} loading={initialLoading} hint={loadedHint} />
        </div>
      </FadeContent>

      <ErrorAlert message={error} title="Could not load settlement batches" />

      <FadeContent trigger="mount" duration={0.5} delay={0.2}>
        <SectionCard
          flush
          title="Batches"
          description={hasFilters ? "Filtered by the criteria above." : "Most recent batch date first."}
        >
          {!loading && !error && batches.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Wallet}
                title="No settlement batches"
                description={
                  hasFilters
                    ? "No batches match these filters. Try widening the date range or clearing the status filter."
                    : "Batches appear here once the first settlement window closes."
                }
                action={
                  hasFilters ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFrom("");
                        setTo("");
                        setStatuses([]);
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Fee</TableHead>
                  <TableHead className="text-right">Net payout</TableHead>
                  <TableHead>Closed</TableHead>
                  <TableHead>Paid</TableHead>
                </TableRow>
              </TableHeader>
              {initialLoading ? (
                <TableSkeleton rows={6} cols={7} />
              ) : (
                <TableBody>
                  {batches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell>
                        <Link
                          to={`/dashboard/settlement/${batch.id}`}
                          className="font-mono font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {batch.batchDate}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={batch.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money fils={batch.grossFils} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money fils={batch.feeFils} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money fils={batch.netPayoutFils} className="font-medium" />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{dateTime(batch.closedAt)}</TableCell>
                      <TableCell className="text-muted-foreground">{dateTime(batch.paidAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              )}
            </Table>
          )}
        </SectionCard>
      </FadeContent>

      <LoadMoreButton nextCursor={nextCursor} loading={loading} onLoadMore={() => void load(nextCursor)} />
    </>
  );
}
