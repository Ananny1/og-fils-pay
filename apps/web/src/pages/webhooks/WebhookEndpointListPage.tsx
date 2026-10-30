import { Eye, MoreHorizontal, Pause, Play, Plus, Trash2, Webhook } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  deleteWebhookEndpoint,
  listWebhookEndpoints,
  updateWebhookEndpoint,
} from "../../api/webhooks.js";
import { describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import FadeContent from "@/components/ui/FadeContent";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ErrorAlert } from "@/components/dashboard/error-alert";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dateTime } from "../../format.js";
import type { WebhookEndpointDto } from "../../types.js";

const COLUMNS = 5;

/**
 * `GET /v1/merchants/:merchantId/webhook-endpoints`. Unlike most
 * list reads in this platform, this one is `owner`/`finance` only
 * server-side — so a `support` user reaching this page gets a real `403`,
 * which `describeError` renders plainly. The nav link is hidden from them too
 * (DashboardLayout), but a typed URL still lands here, and it must explain
 * itself rather than sit on a blank loading state.
 */
export function WebhookEndpointListPage() {
  const { me } = useDashboardAuth();
  const merchantId = me?.merchant.id;

  const [endpoints, setEndpoints] = useState<WebhookEndpointDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WebhookEndpointDto | null>(null);

  const load = useCallback(async () => {
    if (!merchantId) return;
    setLoading(true);
    setError(null);
    try {
      setEndpoints(await listWebhookEndpoints(merchantId));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle(endpoint: WebhookEndpointDto): Promise<void> {
    if (!merchantId) return;
    setBusyId(endpoint.id);
    setError(null);
    const next = endpoint.status === "active" ? "disabled" : "active";
    try {
      await updateWebhookEndpoint(merchantId, endpoint.id, { status: next });
      toast.success(next === "active" ? "Endpoint enabled" : "Endpoint disabled");
      await load();
    } catch (err) {
      const message = describeError(err);
      setError(message);
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  }

  // delete 500s if the endpoint has deliveries — am
  // MK: fixed in FP-240
  /** Confirmed by the AlertDialog below. A hard delete — the endpoint row is
   *  gone, while its delivery log outlives it. */
  async function handleDelete(endpoint: WebhookEndpointDto): Promise<void> {
    if (!merchantId) return;
    setBusyId(endpoint.id);
    setError(null);
    try {
      await deleteWebhookEndpoint(merchantId, endpoint.id);
      toast.success("Endpoint deleted");
      await load();
    } catch (err) {
      const message = describeError(err);
      setError(message);
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  }

  const newEndpointButton = (
    <Button render={<Link to="/dashboard/webhooks/new" />}>
      <Plus data-icon="inline-start" />
      New endpoint
    </Button>
  );

  const initialLoading = loading && endpoints.length === 0;
  const isEmpty = !loading && !error && endpoints.length === 0;

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Where we send a message when something happens on your account."
        actions={newEndpointButton}
      />

      <ErrorAlert message={error} />

      <FadeContent trigger="mount" duration={0.5}>
        {isEmpty ? (
          <EmptyState
            icon={Webhook}
            title="No addresses yet"
            description="Add an address on your server and we'll tell it about every payment and payout the moment it happens. Each message is signed so you can check it came from us."
            action={newEndpointButton}
          />
        ) : (
          <SectionCard flush>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>Secret prefix</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-12 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              {initialLoading ? (
                <TableSkeleton rows={4} cols={COLUMNS} />
              ) : (
                <TableBody>
                  {endpoints.map((endpoint) => {
                    const busy = busyId === endpoint.id;
                    return (
                      <TableRow key={endpoint.id}>
                        <TableCell className="max-w-[24rem]">
                          <Link
                            to={`/dashboard/webhooks/${endpoint.id}`}
                            title={endpoint.url}
                            className="block truncate font-mono text-xs text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
                          >
                            {endpoint.url}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {endpoint.secretPrefix}…
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={endpoint.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {dateTime(endpoint.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Actions for ${endpoint.url}`}
                                  disabled={busy}
                                />
                              }
                            >
                              {busy ? <Spinner /> : <MoreHorizontal />}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                render={<Link to={`/dashboard/webhooks/${endpoint.id}`} />}
                              >
                                <Eye />
                                View deliveries
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void handleToggle(endpoint)}>
                                {endpoint.status === "active" ? <Pause /> : <Play />}
                                {endpoint.status === "active" ? "Disable" : "Enable"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setPendingDelete(endpoint)}
                              >
                                <Trash2 />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              )}
            </Table>
          </SectionCard>
        )}
      </FadeContent>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete this endpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block break-all font-mono text-xs text-foreground">{pendingDelete?.url}</span>
              <span className="mt-2 block">
                This cannot be undone, and its signing secret cannot be recovered. Past deliveries
                stay in the log.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep endpoint</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (target) void handleDelete(target);
              }}
            >
              Delete endpoint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
