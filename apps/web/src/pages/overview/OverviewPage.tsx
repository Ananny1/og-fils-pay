import { formatBhd, toFils } from "@filspay/money";
import { ArrowLeftRight, BarChart3, Ban, Link2, RefreshCw, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { getPayoutTrends, getTopLinks, getVolumes } from "../../api/analytics.js";
import { describeError } from "../../api/client.js";
import FadeContent from "@/components/ui/FadeContent";
import { StalenessBadge } from "@/components/dashboard/staleness-badge";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { Money } from "@/components/dashboard/money";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { StatCard } from "@/components/dashboard/stat-card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TableSkeleton } from "@/components/dashboard/table-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { businessDate, dash, dateTime } from "../../format.js";
import { formatCount } from "../../utils/helpers.js";
import type { PayoutTrendsResponse, TopLinksResponse, VolumesResponse } from "../../types.js";
import { CheckedForm } from "@/components/checked-form";
import { openRowLink } from "@/lib/rowLink";

/** 60s: comfortably above the reporting worker's 15s worst-case lag, and
 *  more than often enough for a dashboard. Poll, not push —
 *  there is no websocket or SSE anywhere in this platform, and this page does
 *  not introduce the first one. */
const POLL_MS = 60_000;

/** One chart row. `bd` is the display number for the axis, derived from the
 *  canonical `formatBhd` string (never `/1000`); `fils` is kept alongside so
 *  the tooltip renders through `<Money>`. */
interface VolumeRow {
  date: string;
  bd: number;
  fils: number;
  count: number;
}

const VOLUME_CHART_CONFIG = {
  bd: { label: "Sales", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

function shortDate(ymd: string): string {
  // YYYY-MM-DD (a Bahrain business date) → "30 Oct". Noon UTC keeps the
  // calendar day fixed; the full date is in the tooltip and the table.
  if (ymd.length !== 10) return ymd;
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
}

export function OverviewPage() {
  // Left blank, the server applies its own "last 30 Asia/Bahrain days"
  // default — the client does not compute a competing one.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [topLinksLimit, setTopLinksLimit] = useState(10);

  const [volumes, setVolumes] = useState<VolumesResponse | null>(null);
  const [payouts, setPayouts] = useState<PayoutTrendsResponse | null>(null);
  const [topLinks, setTopLinks] = useState<TopLinksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mirrors the server's own clamp so this page never displays a limit the
  // server would have silently overridden.
  const clampedLimit = Math.min(50, Math.max(1, Math.trunc(topLinksLimit) || 10));

  const load = useCallback(
    async (options: { manual?: boolean } = {}) => {
      const range = { from: from || undefined, to: to || undefined };
      setLoading(true);
      setError(null);
      try {
        // Three independent endpoints, three independent fetches — there is no
        // combined route to call.
        const [v, p, t] = await Promise.all([
          getVolumes(range),
          getPayoutTrends(range),
          getTopLinks({ ...range, limit: clampedLimit }),
        ]);
        setVolumes(v);
        setPayouts(p);
        setTopLinks(t);
        if (options.manual) toast.success("Overview refreshed");
      } catch (err) {
        const message = describeError(err);
        setError(message);
        if (options.manual) toast.error(message);
      } finally {
        setLoading(false);
      }
    },
    [from, to, clampedLimit],
  );

  // overview memory leak (heap +40mb/hr), pretty sure its these effects — am
  // FH: profiled for 1h, heap flat. maybe it was a browser extension? open
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // Integer sums over the loaded points — plain additions on fils and counts.
  const summary = useMemo(() => {
    const points = volumes?.points ?? [];
    let capturedCount = 0;
    let capturedGrossFils = 0;
    let voidedCount = 0;
    for (const point of points) {
      capturedCount += point.capturedCount;
      capturedGrossFils += point.capturedGrossFils;
      voidedCount += point.voidedCount;
    }
    const batches = payouts?.points ?? [];
    const paidBatches = batches.filter((point) => point.status === "paid").length;
    return { capturedCount, capturedGrossFils, voidedCount, batchCount: batches.length, paidBatches };
  }, [volumes, payouts]);

  const chartRows = useMemo<VolumeRow[]>(
    () =>
      (volumes?.points ?? []).map((point) => ({
        date: point.date,
        bd: Number(formatBhd(toFils(point.capturedGrossFils))),
        fils: point.capturedGrossFils,
        count: point.capturedCount,
      })),
    [volumes],
  );

  const initialLoading = loading && !volumes && !payouts && !topLinks;
  const statsLoading = loading && !volumes;
  // After a failed load with nothing to show, a tile reads "—", not a
  // real-looking 0 that says "you sold nothing".
  const noVolumes = !loading && !volumes;
  const noPayouts = !loading && !payouts;
  const noTopLinks = !loading && !topLinks;
  const unknown = <span className="text-muted-foreground">—</span>;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Sales, payouts and your best links. Leave the dates empty to see the last 30 days."
      />

      <FadeContent trigger="mount" duration={0.5} delay={0.05}>
        <Card>
          <CardContent>
            <CheckedForm
              className="flex flex-wrap items-end gap-x-6 gap-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void load({ manual: true });
              }}
            >
              <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
              <div className="grid gap-1.5">
                <Label htmlFor="top-links-limit" className="text-xs text-muted-foreground">
                  Top links
                </Label>
                <Input
                  id="top-links-limit"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={50}
                  value={topLinksLimit}
                  onChange={(e) => setTopLinksLimit(Number(e.target.value))}
                  className="w-24"
                />
              </div>
              <Button type="submit" disabled={loading} className="ml-auto">
                <RefreshCw className={cn(loading && "animate-spin")} />
                {loading ? "Refreshing…" : "Refresh"}
              </Button>
            </CheckedForm>
          </CardContent>
        </Card>
      </FadeContent>

      <ErrorAlert message={error} title="Could not load analytics" />
      {error ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : null}

      <FadeContent trigger="mount" duration={0.5} delay={0.12}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Captured"
            count={noVolumes ? undefined : summary.capturedCount}
            value={noVolumes ? unknown : undefined}
            icon={ArrowLeftRight}
            loading={statsLoading}
            hint="Card payments taken"
          />
          <StatCard
            label="Sales"
            fils={noVolumes ? undefined : summary.capturedGrossFils}
            value={noVolumes ? unknown : undefined}
            icon={Wallet}
            loading={statsLoading}
            hint="Before fees"
          />
          <StatCard
            label="Voided"
            count={noVolumes ? undefined : summary.voidedCount}
            value={noVolumes ? unknown : undefined}
            icon={Ban}
            loading={statsLoading}
            hint="Cancelled before money was taken"
          />
          <StatCard
            label="Payout days"
            count={noPayouts ? undefined : summary.batchCount}
            value={noPayouts ? unknown : undefined}
            icon={BarChart3}
            loading={loading && !payouts}
            hint={payouts ? `${formatCount(summary.paidBatches)} paid` : undefined}
          />
        </div>
      </FadeContent>

      <div className="grid gap-6 lg:grid-cols-2">
        <FadeContent trigger="mount" duration={0.5} delay={0.2} className="min-w-0">
          <SectionCard
            title="Sales by day"
            description="Sales per day, in BHD."
            action={volumes ? <StalenessBadge readModelAsOf={volumes.readModelAsOf} live={volumes.live} /> : null}
            className="h-full"
          >
            {initialLoading ? (
              <Skeleton className="aspect-video w-full" />
            ) : noVolumes ? (
              <EmptyState icon={BarChart3} title="Sales not loaded" description="Could not load sales. Try Refresh." />
            ) : volumes && volumes.points.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="No sales yet"
                description="No sales in these dates."
              />
            ) : (
              <Tabs defaultValue="chart">
                <TabsList>
                  <TabsTrigger value="chart">Chart</TabsTrigger>
                  <TabsTrigger value="table">Table</TabsTrigger>
                </TabsList>
                <TabsContent value="chart">
                  <ChartContainer config={VOLUME_CHART_CONFIG} className="aspect-video w-full">
                    <BarChart accessibilityLayer data={chartRows} margin={{ left: 4, right: 4 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                        tickFormatter={shortDate}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickMargin={4}
                        width={56}
                        tickFormatter={(value: number) => value.toLocaleString()}
                      />
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            hideIndicator
                            labelFormatter={(label) => businessDate(String(label))}
                            formatter={(_value, _name, item) => {
                              const row = item.payload as VolumeRow | undefined;
                              if (!row) return null;
                              return (
                                <div className="flex w-full flex-col gap-1">
                                  <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">Captured gross</span>
                                    <Money fils={row.fils} className="text-foreground" />
                                  </div>
                                  <div className="flex items-center justify-between gap-4">
                                    <span className="text-muted-foreground">Captured</span>
                                    <span className="font-mono tabular-nums text-foreground">{formatCount(row.count)}</span>
                                  </div>
                                </div>
                              );
                            }}
                          />
                        }
                      />
                      <Bar dataKey="bd" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ChartContainer>
                </TabsContent>
                <TabsContent value="table">
                  <div className="-mx-(--card-spacing) overflow-x-auto border-t">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Captured</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                          <TableHead className="text-right">Voided</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {volumes?.points.map((point) => (
                          <TableRow key={point.date}>
                            <TableCell className="whitespace-nowrap">{businessDate(point.date)}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">{formatCount(point.capturedCount)}</TableCell>
                            <TableCell className="text-right">
                              <Money fils={point.capturedGrossFils} />
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">{formatCount(point.voidedCount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </SectionCard>
        </FadeContent>

        <FadeContent trigger="mount" duration={0.5} delay={0.28} className="min-w-0">
          <SectionCard
            flush
            title="Recent payouts"
            description="Your recent payout days."
            action={payouts ? <StalenessBadge readModelAsOf={payouts.readModelAsOf} live={payouts.live} /> : null}
            className="h-full"
          >
            {noPayouts && !initialLoading ? (
              <div className="p-4">
                <EmptyState icon={Wallet} title="Payouts not loaded" description="Could not load payouts. Try Refresh." />
              </div>
            ) : !initialLoading && payouts && payouts.points.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={Wallet} title="No payouts yet" description="No payouts in these dates yet." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Fee</TableHead>
                      <TableHead className="text-right">Net payout</TableHead>
                      <TableHead>Paid</TableHead>
                    </TableRow>
                  </TableHeader>
                  {initialLoading ? (
                    <TableSkeleton rows={5} cols={6} />
                  ) : (
                    <TableBody>
                      {payouts?.points.map((point) => (
                        <TableRow key={point.settlementBatchId} className="cursor-pointer" onClick={openRowLink}>
                          <TableCell>
                            <Link
                              to={`/dashboard/settlement/${point.settlementBatchId}`}
                              className="font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
                            >
                              {businessDate(point.batchDate)}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={point.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Money fils={point.grossFils} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Money fils={point.feeFils} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Money fils={point.netPayoutFils} className="font-medium" />
                          </TableCell>
                          <TableCell className="text-muted-foreground">{dateTime(point.paidAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  )}
                </Table>
              </div>
            )}
          </SectionCard>
        </FadeContent>

        <FadeContent trigger="mount" duration={0.5} delay={0.36} className="min-w-0 lg:col-span-2">
          <SectionCard
            flush
            title="Best links"
            description={`The ${clampedLimit} highest-value paid payment links in the window.`}
            action={topLinks ? <StalenessBadge readModelAsOf={topLinks.readModelAsOf} live={topLinks.live} /> : null}
          >
            {noTopLinks && !initialLoading ? (
              <div className="p-4">
                <EmptyState icon={Link2} title="Best links not loaded" description="Could not load your best links. Try Refresh." />
              </div>
            ) : !initialLoading && topLinks && topLinks.links.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={Link2} title="No paid links yet" description="None of your links were paid in these dates." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-right">#</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Paid at</TableHead>
                    </TableRow>
                  </TableHeader>
                  {initialLoading ? (
                    <TableSkeleton rows={5} cols={5} />
                  ) : (
                    <TableBody>
                      {topLinks?.links.map((link, index) => (
                        <TableRow key={link.id} className="cursor-pointer" onClick={openRowLink}>
                          <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{index + 1}</TableCell>
                          <TableCell>
                            <Link
                              to={`/dashboard/payment-links/${link.id}`}
                              className="font-medium text-primary underline-offset-4 hover:underline"
                            >
                              {dash(link.reference)}
                            </Link>
                          </TableCell>
                          <TableCell className="max-w-[20rem] truncate text-muted-foreground">{dash(link.description)}</TableCell>
                          <TableCell className="text-right">
                            <Money fils={link.amountFils} className="font-medium" />
                          </TableCell>
                          <TableCell className="text-muted-foreground">{dateTime(link.paidAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  )}
                </Table>
              </div>
            )}
          </SectionCard>
        </FadeContent>
      </div>
    </>
  );
}
