import { AlertTriangle, BookOpen, CheckCircle2, Hourglass, Play, Scale, ShieldAlert, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getReconciliation } from "../../api/settlement.js";
import { ApiError, describeError } from "../../api/client.js";
import FadeContent from "@/components/ui/FadeContent";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { ErrorAlert } from "@/components/dashboard/error-alert";
import { formatMoney } from "@/components/dashboard/money";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { ReconciliationReport } from "../../types.js";

/**
 * `from`/`to` are required by this endpoint (`400 invalid_request` without
 * them), so the page arrives with a filled-in window rather than an empty form
 * that would 400 on first load. `to` is exclusive.
 *
 * The window is anchored to the Asia/Bahrain calendar date, not the viewer's
 * own, because that is the business day `settlement_batches.batch_date` is
 * keyed on — a browser in another timezone would otherwise default to a
 * window off by a day from the batches it's reconciling. Bahrain has observed
 * no DST since 1972, so a fixed +3h shift is exact; this is the same technique
 * apps/api's own analytics route uses.
 */
const BAHRAIN_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

function defaultRange(): { from: string; to: string } {
  const nowBahrain = Date.now() + BAHRAIN_OFFSET_MS;
  const day = (offsetDays: number): string =>
    new Date(nowBahrain + offsetDays * DAY_MS).toISOString().slice(0, 10);
  return { from: day(-30), to: day(1) };
}

// FH: 'explained: false' only shows when settlement is mid-run, a refresh fixes it
// YA: gap != 0 is real when a fee schedule changes mid-period
export function ReconciliationPage() {
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [applied, setApplied] = useState(initial);
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  // Set by the "Run report" submit so only a user-initiated run toasts — the
  // initial load on arrival stays silent.
  const manualRun = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const next = await getReconciliation(applied);
      setReport(next);
      if (manualRun.current) {
        const ok = next.explained && next.gapFils === 0;
        if (ok) toast.success("Reconciled — no gap for this period.");
        else toast.warning(`Reconciliation gap: ${formatMoney(next.gapFils)} BHD`);
      }
    } catch (err) {
      // The one page-specific error branch in this dashboard, because this is
      // the one merchant endpoint with a role gate narrower than "any
      // authenticated merchant user". A `support` user who typed or bookmarked
      // this URL gets a plain explanation — not a crash, not a blank
      // loading-forever state, and no retry.
      if (err instanceof ApiError && err.statusCode === 403) {
        setForbidden(true);
        setReport(null);
      } else {
        const message = describeError(err);
        setError(message);
        if (manualRun.current) toast.error(message);
      }
    } finally {
      manualRun.current = false;
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) {
    return (
      <>
        <PageHeader title="Reconciliation" />
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Permission required</AlertTitle>
          <AlertDescription>
            You don&apos;t have permission to view this report — ask an owner or finance user on your account.
          </AlertDescription>
        </Alert>
      </>
    );
  }

  const reconciled = report ? report.explained && report.gapFils === 0 : false;
  const canRun = from !== "" && to !== "";

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="Compares the ledger's merchant payable against settled net payouts and the pending queue for a period."
      />

      <FadeContent trigger="mount" duration={0.5} delay={0.05}>
        <Card>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-x-6 gap-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                manualRun.current = true;
                // Re-running the same window still refetches: a new object
                // identity changes the `load` dependency.
                setApplied({ from, to });
              }}
            >
              <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
              <Button type="submit" disabled={loading || !canRun}>
                {loading ? <Spinner /> : <Play />}
                {loading ? "Running…" : "Run report"}
              </Button>
              {!canRun ? <p className="text-xs text-muted-foreground">Both dates are required.</p> : null}
            </form>
          </CardContent>
        </Card>
      </FadeContent>

      <ErrorAlert message={error} title="Could not run the report" />

      {report ? (
        <>
          {/* A nonzero gap is shown as a nonzero gap. This page never rounds
              it away, hides it behind a tolerance, or explains it as expected —
              the endpoint reports honestly and so does this. */}
          <FadeContent trigger="mount" duration={0.5} delay={0.1}>
            {reconciled ? (
              <Alert className="border-success/40 bg-success/5 text-success *:data-[slot=alert-description]:text-success/90">
                <CheckCircle2 />
                <AlertTitle>Reconciled — no gap</AlertTitle>
                <AlertDescription>
                  Every captured fil between {report.periodFrom} and {report.periodTo} (exclusive) is accounted
                  for in either a settled batch or the pending queue.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>
                  {report.gapFils !== 0
                    ? `Gap: ${formatMoney(report.gapFils)} BHD`
                    : "Reconciliation incomplete"}
                </AlertTitle>
                <AlertDescription>
                  {report.gapFils !== 0
                    ? `The ledger and settlement figures for ${report.periodFrom} to ${report.periodTo} (exclusive) do not agree. The gap is shown exactly as reported — never rounded away or hidden behind a tolerance.`
                    : `The period ${report.periodFrom} to ${report.periodTo} (exclusive) could not be fully explained yet — a settlement run may be in progress. Run the report again shortly.`}
                </AlertDescription>
              </Alert>
            )}
          </FadeContent>

          <FadeContent trigger="mount" duration={0.5} delay={0.18}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Ledger merchant payable"
                fils={report.ledgerMerchantPayableNetFils}
                icon={BookOpen}
                hint="Net, from the ledger"
              />
              <StatCard
                label="Settlement net payout"
                fils={report.settlementNetPayoutFils}
                icon={Wallet}
                hint="Across settled batches in the period"
              />
              <StatCard
                label="Pending, not yet batched"
                fils={report.pendingUnbatchedFils}
                icon={Hourglass}
                hint="Captured but awaiting a batch"
              />
              <StatCard
                label="Gap"
                fils={report.gapFils}
                icon={Scale}
                hint={reconciled ? "Fully reconciled" : "Unexplained difference"}
                className={reconciled ? undefined : "border-destructive/40"}
              />
            </div>
          </FadeContent>

          <p className="text-xs text-muted-foreground">
            Gap = ledger merchant payable − settlement net payout − pending unbatched. A zero gap means every
            captured fil is accounted for in either a settled batch or the pending queue.
          </p>
        </>
      ) : null}

      {loading && !report ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Ledger merchant payable" loading />
          <StatCard label="Settlement net payout" loading />
          <StatCard label="Pending, not yet batched" loading />
          <StatCard label="Gap" loading />
        </div>
      ) : null}
    </>
  );
}
