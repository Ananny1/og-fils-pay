import { Check, ChevronDown, ListFilter, X } from "lucide-react";
import { DOT_CLASSES, statusTone } from "@/components/dashboard/status-badge";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function pretty(status: string): string {
  const s = status.replaceAll("_", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Multi-select status filter as a dropdown. Selection is owned by the page;
 * this only renders it. Nothing selected means "all statuses".
 * (Kept under its old name so every list page picks it up.)
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
  const summary =
    selected.length === 0
      ? `All ${label.toLowerCase()}es`
      : selected.length === 1
        ? pretty(selected[0]!)
        : `${pretty(selected[0]!)} +${selected.length - 1}`;

  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              className={cn(
                "h-9 w-52 justify-between gap-2 border-input bg-background px-3 text-sm font-normal normal-case tracking-normal shadow-xs hover:border-foreground/20 hover:bg-background hover:text-foreground dark:bg-input/20 dark:hover:bg-input/20",
                selected.length > 0 && "border-primary/40 bg-primary/[0.04]",
              )}
            />
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected.length === 0 ? (
              <ListFilter className="size-3.5 text-muted-foreground" />
            ) : (
              <span className="flex -space-x-1">
                {selected.slice(0, 3).map((s) => (
                  <span key={s} className={cn("size-2 rounded-full ring-2 ring-background", DOT_CLASSES[statusTone(s)])} />
                ))}
              </span>
            )}
            <span className="truncate">{summary}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">Show {label.toLowerCase()}</DropdownMenuLabel>
            {options.map((option) => (
              <DropdownMenuCheckboxItem
                key={option}
                closeOnClick={false}
                checked={selected.includes(option)}
                onCheckedChange={() => onToggle(option)}
              >
                <span className={cn("size-2 rounded-full", DOT_CLASSES[statusTone(option)])} />
                {pretty(option)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
          {onClear ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={selected.length === 0} onClick={onClear}>
                {selected.length === 0 ? <Check /> : <X />}
                {selected.length === 0 ? "Showing everything" : "Clear filter"}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
