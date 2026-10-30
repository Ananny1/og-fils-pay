import {
  ArrowLeftRight,
  ChevronsUpDown,
  LayoutDashboard,
  Link2,
  LogOut,
  Scale,
  Wallet,
  Webhook,
} from "lucide-react";
import { useTheme } from "next-themes";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useDashboardAuth } from "@/auth/DashboardAuthContext";
import type { MerchantRole } from "@/types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEME_OPTIONS } from "@/components/dashboard/theme-toggle";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { describeError } from "@/api/client";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Hidden for roles not listed. UI-only; the API enforces the real gate. */
  roles?: MerchantRole[];
}

const NAV: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Activity",
    items: [
      { to: "/dashboard/overview", label: "Overview", icon: LayoutDashboard },
      { to: "/dashboard/transactions", label: "Transactions", icon: ArrowLeftRight },
      { to: "/dashboard/payment-links", label: "Payment links", icon: Link2 },
    ],
  },
  {
    label: "Money",
    items: [
      { to: "/dashboard/settlement", label: "Payouts", icon: Wallet },
      { to: "/dashboard/reconciliation", label: "Reconciliation", icon: Scale, roles: ["owner", "finance"] },
    ],
  },
  {
    label: "Developers",
    items: [{ to: "/dashboard/webhooks", label: "Webhooks", icon: Webhook, roles: ["owner", "finance"] }],
  },
];

function initials(text: string): string {
  const parts = text.replace(/@.*$/, "").split(/[.\s_-]+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?").slice(0, 2);
}

export function AppSidebar() {
  const { me, signOut } = useDashboardAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const { theme, setTheme } = useTheme();

  async function handleSignOut(): Promise<void> {
    try {
      await signOut();
      navigate("/dashboard/login", { replace: true });
    } catch (err) {
      toast.error(describeError(err));
    }
  }

  const role = me?.role;

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<NavLink to="/dashboard/overview" />} tooltip="FilsPay">
              <div className="flex aspect-square size-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[hsl(4_80%_45%)] text-primary-foreground shadow-elegant">
                <span className="font-semibold tracking-tight">F</span>
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">FilsPay</span>
                <span className="truncate text-xs text-sidebar-muted">{me?.merchant.displayName ?? "Merchant"}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((group) => {
          const items = group.items.filter((item) => !item.roles || !role || item.roles.includes(role));
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
                    return (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton
                          isActive={active}
                          tooltip={item.label}
                          className="relative h-9 rounded-lg transition-colors data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-primary data-[active=true]:before:absolute data-[active=true]:before:inset-y-2 data-[active=true]:before:-left-2 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-full data-[active=true]:before:bg-primary group-data-[collapsible=icon]:before:hidden"
                          render={<NavLink to={item.to} onClick={() => isMobile && setOpenMobile(false)} />}
                        >
                          <item.icon className={cn("transition-transform duration-200 group-hover/menu-item:scale-110", active && "text-primary")} />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                data-sidebar="menu-button"
                data-size="lg"
                className="peer/menu-button flex h-12 w-full items-center gap-2 overflow-hidden rounded-lg p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-0! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0"
              >
                <Avatar className="size-8 rounded-lg ring-1 ring-border">
                  <AvatarFallback className="rounded-lg bg-gradient-to-br from-primary/25 to-chart-2/25 text-xs font-medium">
                    {initials(me?.email ?? "")}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate font-medium">{me?.email ?? "…"}</span>
                  <span className="truncate text-xs text-sidebar-muted capitalize">{me?.role ?? ""}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--anchor-width) min-w-56 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                align="end"
                sideOffset={4}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                      <Avatar className="size-8 rounded-lg">
                        <AvatarFallback className="rounded-lg text-xs">{initials(me?.email ?? "")}</AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-medium">{me?.email}</span>
                        <span className="truncate text-xs text-muted-foreground">{me?.merchant.displayName}</span>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(value) => setTheme(String(value))}>
                    {THEME_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        <option.icon />
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => void handleSignOut()}>
                  <LogOut />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
