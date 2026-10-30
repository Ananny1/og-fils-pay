import { ArrowLeftRight, LayoutDashboard, Link2, Plus, Scale, Search, Wallet, Webhook } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDashboardAuth } from "@/auth/DashboardAuthContext";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { THEME_OPTIONS } from "@/components/dashboard/theme-toggle";

/** ⌘K palette: jump to any section, start common actions, flip the theme. */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { me } = useDashboardAuth();
  const { theme, setTheme } = useTheme();
  const canWrite = me?.role === "owner" || me?.role === "finance";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="hidden h-8 w-56 justify-start gap-2 text-muted-foreground md:inline-flex"
        onClick={() => setOpen(true)}
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left text-xs">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </Button>
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setOpen(true)}>
        <Search />
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Command menu" description="Jump anywhere">
        <CommandInput placeholder="Where do you want to go?" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          <CommandGroup heading="Go to">
            <CommandItem onSelect={() => go("/dashboard/overview")}>
              <LayoutDashboard /> Overview <CommandShortcut>G O</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => go("/dashboard/transactions")}>
              <ArrowLeftRight /> Transactions <CommandShortcut>G T</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => go("/dashboard/payment-links")}>
              <Link2 /> Payment links <CommandShortcut>G L</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => go("/dashboard/settlement")}>
              <Wallet /> Payouts <CommandShortcut>G S</CommandShortcut>
            </CommandItem>
            {canWrite ? (
              <>
                <CommandItem onSelect={() => go("/dashboard/reconciliation")}>
                  <Scale /> Reconciliation
                </CommandItem>
                <CommandItem onSelect={() => go("/dashboard/webhooks")}>
                  <Webhook /> Webhooks
                </CommandItem>
              </>
            ) : null}
          </CommandGroup>
          {canWrite ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Create">
                <CommandItem onSelect={() => go("/dashboard/payment-links/new")}>
                  <Plus /> New payment link
                </CommandItem>
                <CommandItem onSelect={() => go("/dashboard/webhooks/new")}>
                  <Plus /> New webhook endpoint
                </CommandItem>
              </CommandGroup>
            </>
          ) : null}
          <CommandSeparator />
          <CommandGroup heading="Appearance">
            {THEME_OPTIONS.map((option) => (
              <CommandItem
                key={option.value}
                data-checked={theme === option.value}
                onSelect={() => {
                  setTheme(option.value);
                  setOpen(false);
                }}
              >
                <option.icon />
                {option.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
