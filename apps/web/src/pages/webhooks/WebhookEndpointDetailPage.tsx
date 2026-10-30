import { ArrowLeft, Inbox, RotateCcw, Trash2, Webhook } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  deleteWebhookEndpoint,
  listDeliveries,
  listWebhookEndpoints,
  replayDelivery,
  updateWebhookEndpoint,
} from "../../api/webhooks.js";
import { describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import FadeContent from "@/components/ui/FadeContent";
import { CopyButton } from "@/components/dashboard/copy-button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { FilterChips } from "@/components/dashboard/filter-chips";
import { Pager, useCursorPages } from "@/components/dashboard/pager";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TableSkeleton } from "@/components/dashboard/table-skeleton";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dash, dateTime } from "../../format.js";
import type { WebhookDeliveryDto, WebhookDeliveryStatus, WebhookEndpointDto } from "../../types.js";

/** `webhook_deliveries.status`' four CHECK values. Note the dispatcher only
 *  ever writes `succeeded`/`exhausted` — a row awaiting its next attempt
 *  stays `pending`, so `failed` is present in the schema but currently
 *  unwritten. Offered as a filter anyway, since the filter's job is to match
 *  the column, not the dispatcher's current habits. */
const DELIVERY_STATUSES: WebhookDeliveryStatus[] = ["pending", "succeeded", "failed", "exhausted"];


const COLUMNS = 9;

export function WebhookEndpointDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useDashboardAuth();
  const navigate = useNavigate();
  const merchantId = me?.merchant.id;

  const [endpoint, setEndpoint] = useState<WebhookEndpointDto | null>(null);
  const [endpointMissing, setEndpointMissing] = useState(false);
  const [statuses, setStatuses] = useState<WebhookDeliveryStatus[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);

  // Same "no single-resource GET" situation as payment links: the API has
  // the endpoint list and the deliveries sub-resource, but no
  // `GET .../webhook-endpoints/:id`. Merchants have a handful of endpoints,
  // not hundreds, so finding the row in the list is exact in practice here —
  // unlike the payment-link case, where it can genuinely miss.
  const loadEndpoint = useCallback(async () => {
    if (!merchantId || !id) return null;
    setError(null);
    try {
      const all = await listWebhookEndpoints(merchantId);
      const found = all.find((candidate) => candidate.id === id) ?? null;
      setEndpoint(found);
      setEndpointMissing(found === null);
    } catch (err) {
      setError(describeError(err));
    }
  }, [merchantId, id]);

  const loadDeliveries = useCallback(
    async (cursor: string | null, limit: number = 15): Promise<string | null> => {
      if (!merchantId || !id) return null;
      setLoading(true);
      setError(null);
      try {
        const result = await listDeliveries(merchantId, id, {
          status: statuses.length > 0 ? statuses : undefined,
          limit,
          cursor: cursor ?? undefined,
        });
        setDeliveries(result.deliveries);
        setNextCursor(result.nextCursor);
        return result.nextCursor;
      } catch (err) {
        setError(describeError(err));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [merchantId, id, statuses],
  );

  useEffect(() => {
    void loadEndpoint();
  }, [loadEndpoint]);

  const pager = useCursorPages(loadDeliveries);

  function toggleStatus(status: WebhookDeliveryStatus): void {
    setStatuses((previous) =>
      previous.includes(status) ? previous.filter((s) => s !== status) : [...previous, status],
    );
  }

  // FH: fast double click fires replay twice -> dup deliveries + the memory leak
  // busyId disables the button, cant double click — am
  async function handleReplay(delivery: WebhookDeliveryDto): Promise<void> {
    if (!merchantId || !id) return;
    setBusyId(delivery.id);
    try {
      await replayDelivery(merchantId, id, delivery.id);
      toast.success("Replay queued");
      // The replay is a brand-new `pending` row, newest-first, so refetch from
      // the top rather than appending to what's on screen.
      // Back to page 1 by re-running the current page fetch from the top.
      pager.goTo(0);
      await loadDeliveries(null, pager.pageSize);
    } catch (err) {
      // `409 endpoint_disabled` is a real race: someone disabled the endpoint
      // between this page loading and the click.
      toast.error("Replay failed", { description: describeError(err) });
    } finally {
      setBusyId(null);
    }
  }

  /** Same PATCH the list page issues; the Switch in Settings drives it. */
  async function handleToggleEnabled(enabled: boolean): Promise<void> {
    if (!merchantId || !endpoint) return;
    setSettingsBusy(true);
    try {
      await updateWebhookEndpoint(merchantId, endpoint.id, {
        status: enabled ? "active" : "disabled",
      });
      toast.success(enabled ? "Endpoint enabled" : "Endpoint disabled");
      await loadEndpoint();
    } catch (err) {
      toast.error("Could not update the endpoint", { description: describeError(err) });
    } finally {
      setSettingsBusy(false);
    }
  }

  /** Hard delete, confirmed by the AlertDialog. The delivery log outlives
   *  the row, but there is no page left to show it on, so go back to the list. */
  async function handleDelete(): Promise<void> {
    if (!merchantId || !endpoint) return;
    setSettingsBusy(true);
    try {
      await deleteWebhookEndpoint(merchantId, endpoint.id);
      toast.success("Endpoint deleted");
      navigate("/dashboard/webhooks", { replace: true });
    } catch (err) {
      toast.error("Could not delete the endpoint", { description: describeError(err) });
      setSettingsBusy(false);
    }
  }

  const backButton = (
    <Button variant="outline" render={<Link to="/dashboard/webhooks" />}>
      <ArrowLeft data-icon="inline-start" />
      Back to endpoints
    </Button>
  );

  if (endpointMissing) {
    return (
      <>
        <PageHeader title="Webhook endpoint" actions={backButton} />
        <EmptyState
          icon={Webhook}
          title="Endpoint not found"
          description="We couldn't find this address on your account."
          action={
            <Button variant="outline" render={<Link to="/dashboard/webhooks" />}>
              Back to endpoints
            </Button>
          }
        />
      </>
    );
  }

  const initialLoading = loading && deliveries.length === 0;
  const isEmpty = !loading && !error && deliveries.length === 0;

  return (
    <>
      <PageHeader
        title="Webhook endpoint"
        description={
          endpoint ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="break-all font-mono text-xs text-foreground">{endpoint.url}</span>
              <CopyButton value={endpoint.url} label="Copy endpoint URL" />
            </span>
          ) : (
            <Skeleton className="h-4 w-72" />
          )
        }
        actions={
          <>
            {endpoint ? <StatusBadge status={endpoint.status} /> : null}
            {backButton}
          </>
        }
      />

      <ErrorAlert message={error} />

      <Tabs defaultValue="deliveries" className="gap-4">
        <TabsList>
          <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="deliveries" className="flex flex-col gap-4">
          <FilterChips
            options={DELIVERY_STATUSES}
            selected={statuses}
            onToggle={toggleStatus}
            onClear={() => setStatuses([])}
          />

          <FadeContent trigger="mount" duration={0.5} className="flex flex-col gap-4">
            {isEmpty ? (
              <EmptyState
                icon={Inbox}
                title={statuses.length > 0 ? "No deliveries match these filters" : "No deliveries yet"}
                description={
                  statuses.length > 0
                    ? "Try clearing the status filter."
                    : "Deliveries appear here as events are dispatched to this endpoint."
                }
                action={
                  statuses.length > 0 ? (
                    <Button variant="outline" onClick={() => setStatuses([])}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <SectionCard flush>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Attempts</TableHead>
                      <TableHead className="text-right">Response</TableHead>
                      <TableHead>Last attempt</TableHead>
                      <TableHead>Next attempt</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  {initialLoading ? (
                    <TableSkeleton rows={6} cols={COLUMNS} />
                  ) : (
                    <TableBody>
                      {deliveries.map((delivery) => {
                        // Replaying a `pending` row is pointless — it is already queued,
                        // and the dispatcher leaves a row `pending` between retries. And a
                        // replay against a disabled endpoint is rejected `409` server-side,
                        // so the button is hidden rather than offered and refused, since
                        // the endpoint's own state is already known on this page.
                        const replayable =
                          (delivery.status === "succeeded" || delivery.status === "exhausted") &&
                          endpoint?.status === "active";
                        return (
                          <TableRow key={delivery.id}>
                            <TableCell>
                              <div className="flex flex-col gap-0.5">
                                <span className="font-mono text-xs" title={delivery.id}>
                                  {delivery.id}
                                </span>
                                {delivery.replayOfDeliveryId ? (
                                  <span
                                    className="text-xs text-muted-foreground"
                                    title={delivery.replayOfDeliveryId}
                                  >
                                    replay of{" "}
                                    <span className="font-mono">{delivery.replayOfDeliveryId}</span>
                                  </span>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono">
                                {delivery.eventType}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={delivery.status} />
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {delivery.attemptCount}
                            </TableCell>
                            <TableCell className="text-right">
                              <ResponseCell delivery={delivery} />
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {dateTime(delivery.lastAttemptedAt)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {dateTime(delivery.nextAttemptAt)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {dateTime(delivery.createdAt)}
                            </TableCell>
                            <TableCell className="text-right">
                              {replayable ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={busyId === delivery.id}
                                  onClick={() => void handleReplay(delivery)}
                                >
                                  {busyId === delivery.id ? (
                                    <Spinner data-icon="inline-start" />
                                  ) : (
                                    <RotateCcw data-icon="inline-start" />
                                  )}
                                  Replay
                                </Button>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  )}
                </Table>
              </SectionCard>
            )}

            <Pager pager={pager} loading={loading} rowCount={deliveries.length} noun="deliveries" className="rounded-xl border bg-card" />
          </FadeContent>
        </TabsContent>

        <TabsContent value="settings" className="flex flex-col gap-4">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Delivery</CardTitle>
              <CardDescription>
                A disabled endpoint receives nothing and rejects replays; re-enable it to resume.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Enabled</span>
                  <span className="text-xs text-muted-foreground">
                    {endpoint ? (
                      endpoint.status === "active" ? (
                        "Events are being delivered to this endpoint."
                      ) : (
                        "Deliveries are paused."
                      )
                    ) : (
                      <Skeleton className="h-3 w-40" />
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {settingsBusy ? <Spinner className="text-muted-foreground" /> : null}
                  <Switch
                    aria-label="Enable endpoint"
                    checked={endpoint?.status === "active"}
                    disabled={!endpoint || settingsBusy}
                    onCheckedChange={(checked) => void handleToggleEnabled(checked)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                <Detail label="Endpoint id">
                  <span className="font-mono text-xs">{dash(endpoint?.id)}</span>
                </Detail>
                <Detail label="Secret prefix">
                  <span className="font-mono">{endpoint ? `${endpoint.secretPrefix}…` : "—"}</span>
                </Detail>
                <Detail label="Created">{dateTime(endpoint?.createdAt)}</Detail>
                <Detail label="Updated">{dateTime(endpoint?.updatedAt)}</Detail>
              </dl>
              <p className="mt-4 text-xs text-muted-foreground">
                The signing secret was shown once when this endpoint was created and cannot be
                re-read. To rotate it, delete this endpoint and create a new one.
              </p>
            </CardContent>
          </Card>

          <Card className="max-w-2xl border-destructive/30">
            <CardHeader>
              <CardTitle className="text-destructive">Danger zone</CardTitle>
              <CardDescription>
                Deleting is permanent. Past deliveries stay in the log, but the endpoint and its
                secret are gone.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AlertDialog>
                <AlertDialogTrigger
                  render={<Button variant="destructive" disabled={!endpoint || settingsBusy} />}
                >
                  <Trash2 data-icon="inline-start" />
                  Delete endpoint
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogMedia className="bg-destructive/10 text-destructive">
                      <Trash2 />
                    </AlertDialogMedia>
                    <AlertDialogTitle>Delete this endpoint?</AlertDialogTitle>
                    <AlertDialogDescription>
                      <span className="block break-all font-mono text-xs text-foreground">
                        {endpoint?.url}
                      </span>
                      <span className="mt-2 block">
                        This cannot be undone, and its signing secret cannot be recovered.
                      </span>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep endpoint</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
                      Delete endpoint
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

/** Last response status code, with the body excerpt (when the dispatcher
 *  kept one) behind a popover rather than inline in the row. */
function ResponseCell({ delivery }: { delivery: WebhookDeliveryDto }) {
  const code = delivery.responseStatusCode;
  const tone =
    code === null
      ? "text-muted-foreground"
      : code >= 200 && code < 300
        ? "text-success"
        : "text-destructive";
  if (!delivery.responseBodyExcerpt) {
    return <span className={`font-mono tabular-nums ${tone}`}>{dash(code)}</span>;
  }
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="xs" className={`font-mono tabular-nums ${tone}`} />}
      >
        {dash(code)}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Response body
        </p>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">
          {delivery.responseBodyExcerpt}
        </pre>
      </PopoverContent>
    </Popover>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-all">{children}</dd>
    </div>
  );
}
