import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "destructive" | "info" | "muted";

const TONE_BY_STATUS: Record<string, Tone> = {
  // transactions
  captured: "success",
  authorized: "warning",
  partially_captured: "warning",
  voided: "destructive",
  partially_refunded: "info",
  refunded: "info",
  chargeback: "destructive",
  // payment links
  active: "success",
  reserved: "warning",
  processing: "warning",
  paid: "success",
  expired: "muted",
  canceled: "destructive",
  // settlement batches
  open: "warning",
  closed: "info",
  // webhooks
  pending: "warning",
  succeeded: "success",
  failed: "destructive",
  exhausted: "destructive",
  archived: "muted",
  disabled: "muted",
  enabled: "success",
};

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success/10 text-success border-success/25",
  warning: "bg-warning/10 text-warning border-warning/30",
  destructive: "bg-destructive/10 text-destructive border-destructive/25",
  info: "bg-info/10 text-info border-info/25",
  muted: "bg-muted text-muted-foreground border-border",
};

/** One consistent pill for every status string the API returns. Unknown
 *  statuses fall back to the muted tone rather than breaking the page. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = TONE_BY_STATUS[status] ?? "muted";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap capitalize",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {status.replaceAll("_", " ")}
    </span>
  );
}
