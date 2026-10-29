import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Two native date inputs. Values are `YYYY-MM-DD` strings or "". */
export function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
  className,
}: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      <div className="grid gap-1.5">
        <Label htmlFor="date-from" className="text-xs text-muted-foreground">
          From
        </Label>
        <Input id="date-from" type="date" value={from} onChange={(e) => onFromChange(e.target.value)} className="w-[10.5rem]" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="date-to" className="text-xs text-muted-foreground">
          Before
        </Label>
        <Input id="date-to" type="date" value={to} onChange={(e) => onToChange(e.target.value)} className="w-[10.5rem]" />
      </div>
    </div>
  );
}
