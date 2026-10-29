import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A row of toggleable status chips — the multi-select filter every keyset
 * list page uses. Selection is owned by the page; this only renders it.
 */
export function FilterChips<T extends string>({
  label = "Status",
  options,
  selected,
  onToggle,
  onClear,
  className,
}: {
  label?: string;
  options: readonly T[];
  selected: readonly T[];
  onToggle: (option: T) => void;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {options.map((option) => {
        const active = selected.includes(option);
        return (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            aria-pressed={active}
            className="rounded-full capitalize"
            onClick={() => onToggle(option)}
          >
            {option.replaceAll("_", " ")}
          </Button>
        );
      })}
      {onClear && selected.length > 0 ? (
        <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={onClear}>
          <X data-icon="inline-start" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
