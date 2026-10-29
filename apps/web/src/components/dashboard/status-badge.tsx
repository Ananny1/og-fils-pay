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

/** Dot colour for a status, shared by the badge and the status filter. */
export const DOT_CLASSES: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  muted: "bg-muted-foreground/50",
};

export function statusTone(status: string): Tone {
  return TONE_BY_STATUS[status] ?? "muted";
}

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success/10 text-success border-success/25",
  warning: "bg-warning/10 text-warning border-warning/30",
  destructive: "bg-destructive/10 text-destructive border-destructive/25",
  info: "bg-info/10 text-info border-info/25",
  muted: "bg-muted text-muted-foreground border-border",
};

/** Every status as a rubber stamp: red ink for things that need attention
 *  (open, pending, failed, voided), dark ink for settled ones (paid,
 *  captured, succeeded), grey for inactive. Rotated -2deg like a real stamp. */
const STAMP_INK: Record<Tone, string> = {
  success: "case-stamp--ink",
  info: "case-stamp--ink",
  warning: "",
  destructive: "",
  muted: "case-stamp--muted",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = TONE_BY_STATUS[status] ?? "muted";
  return <span className={cn("case-stamp", STAMP_INK[tone], className)}>{status.replaceAll("_", " ")}</span>;
}
