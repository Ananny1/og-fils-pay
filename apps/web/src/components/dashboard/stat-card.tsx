import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { formatBhd, toFils } from "@filspay/money";
import CountUp from "@/components/ui/CountUp";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * KPI tile. `fils` animates to the exact `formatBhd` value with three
 * decimals (display only — derived from the canonical formatter, never
 * `/1000`). `count` animates an integer. `value` renders any node.
 * A soft accent glow follows the pointer on hover.
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
      <span className={cn("case-numeral tabular-nums", fils < 0 && "text-destructive")}>
        {fils < 0 ? "−" : ""}
        <CountUp to={bd} duration={1.1} decimals={3} separator="," trigger="load" />
        <span className="ml-1.5 align-baseline font-mono text-xs font-medium tracking-[0.12em] text-muted-foreground">BHD</span>
      </span>
    );
  } else if (count !== undefined) {
    body = <CountUp to={count} duration={0.9} separator="," trigger="load" className="case-numeral tabular-nums" />;
  }

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  }

  return (
    <div
      onMouseMove={onMove}
      className={cn(
        "group relative overflow-hidden border border-[var(--card-border)] bg-card p-5 text-card-foreground",
        className,
      )}
    >

      <div className="relative flex items-start justify-between gap-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
        {Icon ? (
          <span className="flex size-8 items-center justify-center border border-[var(--card-border)] text-foreground">
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>
      <div className="relative mt-3 text-[2.4rem] leading-none">
        {loading ? <Skeleton className="h-8 w-36" /> : body}
      </div>
      {(hint !== undefined || delta !== undefined) && (
        <div className="relative mt-2 flex items-center gap-2 text-xs text-muted-foreground">
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
    </div>
  );
}
