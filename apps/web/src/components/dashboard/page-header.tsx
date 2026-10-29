import type { ReactNode } from "react";
import BlurText from "@/components/BlurText";
import { cn } from "@/lib/utils";

/** Title row for every dashboard page: animated title, optional
 *  description, and an actions slot that wraps on small screens. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="space-y-1">
        <BlurText
          text={title}
          animateBy="words"
          direction="top"
          delay={60}
          className="text-2xl font-semibold tracking-tight md:text-3xl"
        />
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
