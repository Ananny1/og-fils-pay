import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** A titled card whose content sits flush (for tables) or padded. */
export function SectionCard({
  title,
  description,
  action,
  children,
  flush = false,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("rounded-xl", flush && "gap-0 py-0 overflow-hidden", className)}>
      {title || action ? (
        <CardHeader className={cn(flush && "border-b bg-muted/20 py-4")}>
          {title ? <CardTitle>{title}</CardTitle> : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
          {action ? <CardAction>{action}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn(flush && "p-0")}>{children}</CardContent>
    </Card>
  );
}
