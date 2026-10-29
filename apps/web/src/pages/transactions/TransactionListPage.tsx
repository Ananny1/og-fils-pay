import { Search, SearchX, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listTransactions } from "../../api/transactions.js";
import { describeError } from "../../api/client.js";
import FadeContent from "@/components/FadeContent";
import { CopyButton } from "@/components/dashboard/copy-button";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { Money } from "@/components/dashboard/money";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TableSkeleton } from "@/components/dashboard/table-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { dash, dateTime, dayStartIso } from "../../format.js";
import { pluralize, truncateMiddle } from "../../utils/helpers.js";
import type { TransactionDto, TransactionStatus } from "../../types.js";

const STATUSES: TransactionStatus[] = [
  "authorized",
  "captured",
  "partially_captured",
  "voided",
  "partially_refunded",
  "refunded",
  "chargeback",
];

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

/** One segment of the status filter. `aria-pressed` carries the toggle
 *  state so the segmented look is also announced as a toggle. */
function StatusChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium capitalize whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "bg-background text-foreground shadow-xs ring-1 ring-foreground/10"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * `GET /v1/transactions`. Every control here is a real server-side
 * query param — nothing fetches an unfiltered page and narrows it in the
 * browser, which would both lie about the result count and break pagination.
 */
// YA: from/to are UTC day starts, see dayStartIso
export function TransactionListPage() {
  const [statuses, setStatuses] = useState<TransactionStatus[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [transactions, setTransactions] = useState<TransactionDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce only the text box — the checkbox/date controls fire immediately,
  // since those are discrete choices, not a stream of keystrokes.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const result = await listTransactions({
          status: statuses.length > 0 ? statuses : undefined,
          from: dayStartIso(from),
          to: dayStartIso(to),
          search: search || undefined,
          limit: PAGE_SIZE,
          cursor: cursor ?? undefined,
        });
        setTransactions((previous) =>
          cursor ? [...previous, ...result.transactions] : result.transactions,
        );
        setNextCursor(result.nextCursor);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setLoading(false);
      }
    },
    [statuses, from, to, search],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  function toggleStatus(status: TransactionStatus): void {
    setStatuses((previous) =>
      previous.includes(status) ? previous.filter((s) => s !== status) : [...previous, status],
    );
  }

  const hasFilters = statuses.length > 0 || from !== "" || to !== "" || searchInput !== "";

  function clearFilters(): void {
    setStatuses([]);
    setFrom("");
    setTo("");
    setSearchInput("");
  }

  const initialLoading = loading && transactions.length === 0;
  const empty = !loading && transactions.length === 0;

  const countLine = initialLoading
    ? "Loading…"
    : `${pluralize(transactions.length, "transaction")} loaded${nextCursor ? " · more available" : ""}`;

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every authorization, capture, void and refund on your account, newest first."
      />

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Status</span>
            <div
              role="group"
              aria-label="Filter by status"
              className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1"
            >
              <StatusChip active={statuses.length === 0} onClick={() => setStatuses([])}>
                All
              </StatusChip>
              {STATUSES.map((status) => (
                <StatusChip key={status} active={statuses.includes(status)} onClick={() => toggleStatus(status)}>
                  {status.replaceAll("_", " ")}
                </StatusChip>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {/* "To" is exclusive, because the endpoint's own predicate is
                `occurred_at < to` — labelled rather than quietly shifted by a
                day here, which would make this page and the API disagree about
                what a filter means. */}
            <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />

            <div className="grid min-w-[16rem] flex-1 gap-1.5">
              <Label htmlFor="txn-search" className="text-xs text-muted-foreground">
                Search
              </Label>
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="txn-search"
                  type="search"
                  className="pl-8"
                  placeholder="Reference, acquirer reference, or transaction id"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
            </div>

            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X />
                Clear filters
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <ErrorAlert message={error} title="Couldn't load transactions" />

      <FadeContent trigger="mount" duration={0.5} initialOpacity={0}>
        <SectionCard flush title="Results" description={countLine}>
          {empty ? (
            <div className="p-6">
              <EmptyState
                icon={SearchX}
                title="No transactions match these filters"
                description={
                  hasFilters
                    ? "Try widening the date range or clearing a status."
                    : "Transactions appear here as soon as a payment is authorized."
                }
                action={
                  hasFilters ? (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
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
                  <TableHead>Occurred</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Authorized</TableHead>
                  <TableHead className="text-right">Captured</TableHead>
                  <TableHead>Acquirer ref</TableHead>
                </TableRow>
              </TableHeader>
              {initialLoading ? (
                <TableSkeleton rows={8} cols={6} />
              ) : (
                <TableBody>
                  {transactions.map((txn) => (
                    <TableRow key={txn.id}>
                      <TableCell className="whitespace-nowrap">
                        <Link
                          to={`/dashboard/transactions/${txn.id}`}
                          className="font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          {dateTime(txn.occurredAt)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">{dash(txn.reference)}</span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={txn.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Money fils={txn.amountFils} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Money fils={txn.capturedFils} />
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1">
                          <span className="font-mono text-xs" title={txn.acquirerReference}>
                            {truncateMiddle(txn.acquirerReference, 20)}
                          </span>
                          <CopyButton value={txn.acquirerReference} label="Copy acquirer reference" />
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              )}
            </Table>
          )}

          {/* `nextCursor` is an opaque server-issued token, passed straight
              back on the next request and never inspected here. The footer
              disappears once the server says there is no next page. */}
          {nextCursor ? (
            <div className="flex items-center justify-center border-t bg-muted/50 px-4 py-3">
              <Button variant="outline" disabled={loading} onClick={() => void load(nextCursor)}>
                {loading ? <Spinner /> : null}
                {loading ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </SectionCard>
      </FadeContent>
    </>
  );
}
