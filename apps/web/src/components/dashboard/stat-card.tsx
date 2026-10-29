import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { formatBhd, toFils } from "@filspay/money";
import CountUp from "@/components/CountUp";
import SpotlightCard from "@/components/SpotlightCard";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * KPI tile. `fils` animates to the exact `formatBhd` string's numeric value
 * with three decimals (display only — the number is derived from the
 * canonical formatter, never from `/1000`). `count` animates an integer.
 * `value` renders any ready-made node. `delta` (percent) shows a trend chip.
 */
export function StatCard({
  label,
  fils,
  count,
  value,
  hint,
  icon: Icon,
  delta,
  loading = false,
  className,
}: {
  label: string;
  fils?: number;
  count?: number;
  value?: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  delta?: number;
  loading?: boolean;
  className?: string;
}) {
  let body: ReactNode = value ?? null;
  if (fils !== undefined) {
    const bd = Number(formatBhd(toFils(Math.abs(fils))));
    body = (
      <span className={cn("font-mono tabular-nums", fils < 0 && "text-destructive")}>
        {fils < 0 ? "−" : ""}
        <CountUp to={bd} duration={1.1} decimals={3} separator="," trigger="load" />
        <span className="ml-1.5 text-sm font-medium text-muted-foreground">BHD</span>
      </span>
    );
  } else if (count !== undefined) {
    body = <CountUp to={count} duration={0.9} separator="," trigger="load" className="font-mono tabular-nums" />;
  }

  return (
    <SpotlightCard
      className={cn(
        "card-shine group relative overflow-hidden rounded-2xl border border-border/70 bg-card p-5 text-card-foreground shadow-card transition-all hover:-translate-y-0.5 hover:shadow-hover",
        className,
      )}
      spotlightColor="var(--primary)"
      intensity={0.12}
      spotlightSize={260}
      theme="light"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-12 size-32 rounded-full bg-primary/[0.06] blur-3xl opacity-70 transition-opacity group-hover:opacity-100"
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        {Icon ? (
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>
      <div className="mt-3 text-[1.75rem] font-semibold leading-none tracking-tight">
        {loading ? <Skeleton className="h-8 w-36" /> : body}
      </div>
      {(hint !== undefined || delta !== undefined) && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          {delta !== undefined ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium",
                delta >= 0 ? "bg-success/12 text-success" : "bg-destructive/10 text-destructive",
              )}
            >
              {delta >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              {Math.abs(delta).toFixed(1)}%
            </span>
          ) : null}
          {hint ? <span>{hint}</span> : null}
        </div>
      )}
    </SpotlightCard>
  );
}
