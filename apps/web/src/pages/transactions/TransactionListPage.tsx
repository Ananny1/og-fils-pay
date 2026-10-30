import { Search, SearchX, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listTransactions } from "../../api/transactions.js";
import { describeError } from "../../api/client.js";
import FadeContent from "@/components/ui/FadeContent";
import { CopyButton } from "@/components/dashboard/copy-button";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { Money } from "@/components/dashboard/money";
import { FilterChips } from "@/components/dashboard/filter-chips";
import { Pager, useCursorPages } from "@/components/dashboard/pager";
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

const SEARCH_DEBOUNCE_MS = 300;

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

  // Loads exactly one page and returns its cursor for the next one.
  const fetchPage = useCallback(
    async (cursor: string | null, limit: number): Promise<string | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await listTransactions({
          status: statuses.length > 0 ? statuses : undefined,
          from: dayStartIso(from),
          to: dayStartIso(to),
          search: search || undefined,
          limit,
          cursor: cursor ?? undefined,
        });
        setTransactions(result.transactions);
        setNextCursor(result.nextCursor);
        return result.nextCursor;
      } catch (err) {
        setError(describeError(err));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [statuses, from, to, search],
  );
  const pager = useCursorPages(fetchPage);

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
    : `Page ${pager.page + 1} · ${pluralize(transactions.length, "transaction")}${nextCursor ? "" : " · last page"}`;

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every card payment, newest first. Open one to see what happened to it."
      />

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <FilterChips options={STATUSES} selected={statuses} onToggle={toggleStatus} onClear={() => setStatuses([])} />
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
                  placeholder="Search by reference or payment ID"
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
                title="Nothing matches these filters"
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
                          <CopyButton value={txn.acquirerReference} label="Copy card network reference" />
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              )}
            </Table>
          )}

          <Pager pager={pager} loading={loading} rowCount={transactions.length} noun="transactions" className="bg-muted/30" />
        </SectionCard>
      </FadeContent>
    </>
  );
}
