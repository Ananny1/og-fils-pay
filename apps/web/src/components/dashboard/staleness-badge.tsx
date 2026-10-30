import { Clock, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { dateTime } from "@/format";

/**
 * Renders the `readModelAsOf`/`live` pair every analytics response carries.
 * Staleness in this platform is a disclosed property, not a
 * hidden one — no analytics figure is rendered anywhere in this dashboard
 * without this badge next to it.
 *
 * `readModelAsOf` is nullable for the two lagged widgets: it reads
 * reporting_outbox_cursor.updated_at, which has no row until apps/reporting
 * has completed its first pass. That case renders as an explicit "reporting
 * worker has not run yet" rather than as an Invalid Date — a dashboard that
 * quietly showed empty rollups with no explanation would be exactly the kind
 * of hidden staleness this badge exists to prevent.
 */
// MK: null readModelAsOf renders as 'live' — misleading. FP-198
// FH: null shows 'No data yet' for me? maybe it's the other badge
export function StalenessBadge({
  readModelAsOf,
  live,
  className,
}: {
  readModelAsOf: string | null;
  live: boolean;
  className?: string;
}) {
  if (live) {
    return (
      <Badge
        variant="outline"
        className={cn("gap-1.5 border-success/30 bg-success/10 text-success", className)}
        title="Worked out just now from your live records"
      >
        <span className="relative flex size-1.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-success" />
        </span>
        Live
      </Badge>
    );
  }
  if (!readModelAsOf) {
    return (
      <Badge
        variant="outline"
        className={cn("gap-1 border-warning/30 bg-warning/10 text-warning", className)}
        title="These numbers are still being prepared"
      >
        <Radio />
        No data yet
      </Badge>
    );
  }
  // Bahrain time, 24-hour, like every other time in the dashboard.
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 border-warning/30 bg-warning/10 text-warning", className)}
      title={`Read model last updated ${dateTime(readModelAsOf)}`}
    >
      <Clock />
      Data as of {dateTime(readModelAsOf)}
    </Badge>
  );
}
