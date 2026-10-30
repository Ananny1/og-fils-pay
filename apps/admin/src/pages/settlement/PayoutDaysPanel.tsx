import { useCallback, useEffect, useState } from "react";
import { formatBhd, toFils } from "@filspay/money";
import { listSettlementDays, runBatch } from "../../api/settlement.js";
import { describeError } from "../../api/client.js";
import { RequireRole } from "../../auth/RequireRole.js";
import type { RunBatchSummary, SettlementDay, SettlementDayStatus } from "../../types.js";

function bhd(fils: number): string {
  return `${formatBhd(toFils(fils, { allowNegative: true }))} BHD`;
}

/** "Fri, 30 Oct" for a plain business date (no timezone maths on a DATE). */
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const STATUS: Record<SettlementDayStatus, { label: string; className: string }> = {
  running: { label: "Still running", className: "admin-status admin-status--disabled" },
  needs_closing: { label: "Not closed", className: "admin-status" },
  closed_unpaid: { label: "Closed, not paid", className: "admin-status" },
  done: { label: "Paid", className: "admin-status admin-status--paid" },
};

/**
 * "Payout days" (FP-301): the last 7 Bahrain business days and what each
 * still needs, so nobody types a date or a merchant id by hand. Close & pay
 * is offered only for a day that is over and still has unclaimed sales; the
 * server refuses a running day anyway (BUG-095). Closing runs every eligible
 * merchant for that date through the same audited run-batch endpoint.
 */
export function PayoutDaysPanel({ onRun }: { onRun: (summary: RunBatchSummary) => void }) {
  const [days, setDays] = useState<SettlementDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDays((await listSettlementDays()).days);
      setError(null);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function closeDay(date: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onRun(await runBatch({ date }));
      setConfirming(null);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Payout days</h2>
      <p className="admin-muted">
        The last 7 business days (midnight to midnight, Bahrain time). Each day is closed and paid
        automatically shortly after midnight; a day shows <strong>Not closed</strong> only if that did
        not happen. Today can't be closed until it is over.
      </p>

      {error ? <p className="admin-error">{error}</p> : null}

      {days === null && !error ? <p className="admin-muted">Loading…</p> : null}

      {days ? (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Status</th>
              <th className="admin-num">Waiting to be paid</th>
              <th className="admin-num">Shops paid</th>
              <th className="admin-num">Gross</th>
              <th className="admin-num">Fee</th>
              <th className="admin-num">Net paid</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const status = STATUS[day.status];
              return (
                <tr key={day.businessDate}>
                  <td>
                    {dayLabel(day.businessDate)} <span className="admin-muted">{day.businessDate}</span>
                  </td>
                  <td>
                    <span className={status.className}>{status.label}</span>
                  </td>
                  <td className="admin-num">
                    {day.waitingFils > 0
                      ? `${bhd(day.waitingFils)} · ${day.waitingMerchantCount} shop${day.waitingMerchantCount === 1 ? "" : "s"}`
                      : "—"}
                  </td>
                  <td className="admin-num">
                    {day.batchCount > 0 ? `${day.paidBatchCount} / ${day.batchCount}` : "—"}
                  </td>
                  <td className="admin-num">{day.batchCount > 0 ? bhd(day.grossFils) : "—"}</td>
                  <td className="admin-num">{day.batchCount > 0 ? bhd(day.feeFils) : "—"}</td>
                  <td className="admin-num">{day.batchCount > 0 ? bhd(day.netPayoutFils) : "—"}</td>
                  <td>
                    {day.status === "running" ? (
                      <span className="admin-muted">After midnight</span>
                    ) : day.status === "needs_closing" || day.status === "closed_unpaid" ? (
                      <RequireRole allow={["finance", "super_admin"]} fallback={null}>
                        {confirming === day.businessDate ? (
                          <span className="admin-confirm">
                            Close and pay {day.businessDate} for every shop?{" "}
                            <button type="button" disabled={busy} onClick={() => void closeDay(day.businessDate)}>
                              {busy ? "Closing..." : "Yes, close & pay"}
                            </button>{" "}
                            <button type="button" disabled={busy} onClick={() => setConfirming(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setConfirming(day.businessDate)}>
                            Close &amp; pay
                          </button>
                        )}
                      </RequireRole>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
