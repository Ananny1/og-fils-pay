import { Link as LinkIcon, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listPaymentLinks } from "../../api/paymentLinks.js";
import { describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import { RequireRole } from "../../auth/RequireRole.js";
import FadeContent from "@/components/ui/FadeContent";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { FilterChips } from "@/components/dashboard/filter-chips";
import { LoadMoreButton } from "@/components/dashboard/load-more";
import { Money } from "@/components/dashboard/money";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TableSkeleton } from "@/components/dashboard/table-skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dash, dateTime } from "../../format.js";
import type { PaymentLinkDto, PaymentLinkStatus } from "../../types.js";

/** The four *stored* statuses, including `reserved` — the merchant-facing
 *  list deliberately exposes it distinctly rather than collapsing it into the
 *  public enum's `processing`, because a merchant needs to see that a link is
 *  mid-payment-attempt. */
const STATUSES: PaymentLinkStatus[] = ["active", "reserved", "paid", "canceled"];

const PAGE_SIZE = 25;

const COLUMNS = 7;

/**
 * Keyset paginated, newest first.
 * — FH
 */
export function PaymentLinkListPage() {
  const { me } = useDashboardAuth();
  const merchantId = me?.merchant.id;

  const [statuses, setStatuses] = useState<PaymentLinkStatus[]>([]);
  const [links, setLinks] = useState<PaymentLinkDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      if (!merchantId) return;
      setLoading(true);
      setError(null);
      try {
        const result = await listPaymentLinks(merchantId, {
          status: statuses.length > 0 ? statuses : undefined,
          limit: PAGE_SIZE,
          cursor: cursor ?? undefined,
        });
        setLinks((previous) => (cursor ? [...previous, ...result.paymentLinks] : result.paymentLinks));
        setNextCursor(result.nextCursor);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setLoading(false);
      }
    },
    [merchantId, statuses],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  function toggleStatus(status: PaymentLinkStatus): void {
    setStatuses((previous) =>
      previous.includes(status) ? previous.filter((s) => s !== status) : [...previous, status],
    );
  }

  const newLinkButton = (
    <RequireRole allow={["owner", "finance"]}>
      <Button render={<Link to="/dashboard/payment-links/new" />}>
        <Plus data-icon="inline-start" />
        New payment link
      </Button>
    </RequireRole>
  );

  const initialLoading = loading && links.length === 0;
  const isEmpty = !loading && !error && links.length === 0;

  return (
    <>
      <PageHeader
        title="Payment links"
        description="Shareable checkout links, newest first."
        actions={newLinkButton}
      />

      <FilterChips
        options={STATUSES}
        selected={statuses}
        onToggle={toggleStatus}
        onClear={() => setStatuses([])}
      />

      <ErrorAlert message={error} />

      <FadeContent trigger="mount" duration={0.5} className="flex flex-col gap-4">
        {isEmpty ? (
          <EmptyState
            icon={LinkIcon}
            title={statuses.length > 0 ? "No payment links match these filters" : "No payment links yet"}
            description={
              statuses.length > 0
                ? "Try clearing the status filter."
                : "Create a link, share it with a customer, and the payment shows up here."
            }
            action={
              statuses.length > 0 ? (
                <Button variant="outline" onClick={() => setStatuses([])}>
                  Clear filters
                </Button>
              ) : (
                <RequireRole allow={["owner", "finance"]}>
                  <Button render={<Link to="/dashboard/payment-links/new" />}>
                    <Plus data-icon="inline-start" />
                    Create your first link
                  </Button>
                </RequireRole>
              )
            }
          />
        ) : (
          <SectionCard flush>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Canceled</TableHead>
                </TableRow>
              </TableHeader>
              {initialLoading ? (
                <TableSkeleton rows={8} cols={COLUMNS} />
              ) : (
                <TableBody>
                  {links.map((link) => (
                    <TableRow key={link.id}>
                      <TableCell className="font-medium">
                        <Link
                          to={`/dashboard/payment-links/${link.id}`}
                          className="font-mono text-primary underline-offset-4 hover:underline"
                        >
                          {dash(link.reference)}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[18rem] truncate text-muted-foreground">
                        {dash(link.description)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money fils={link.amountFils} currency={link.currency} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={link.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateTime(link.expiresAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateTime(link.paidAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateTime(link.canceledAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              )}
            </Table>
          </SectionCard>
        )}

        <LoadMoreButton nextCursor={nextCursor} loading={loading} onLoadMore={() => void load(nextCursor)} />
      </FadeContent>
    </>
  );
}
