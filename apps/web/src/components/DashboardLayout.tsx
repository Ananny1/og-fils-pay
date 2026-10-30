import { Fragment } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import ClickSpark from "@/components/ui/ClickSpark";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AssistantPanel } from "@/components/dashboard/assistant-panel";
import { CommandMenu } from "@/components/dashboard/command-menu";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

const SECTION_LABELS: Record<string, string> = {
  overview: "Overview",
  transactions: "Transactions",
  "payment-links": "Payment links",
  webhooks: "Webhooks",
  settlement: "Payouts",
  reconciliation: "Reconciliation",
};

function useCrumbs(): Array<{ label: string; to?: string }> {
  const { pathname } = useLocation();
  const parts = pathname.replace(/^\/dashboard\/?/, "").split("/").filter(Boolean);
  const [section, rest] = [parts[0], parts.slice(1)];
  if (!section) return [{ label: "Dashboard" }];
  const crumbs: Array<{ label: string; to?: string }> = [
    { label: SECTION_LABELS[section] ?? section, to: rest.length ? `/dashboard/${section}` : undefined },
  ];
  if (rest[0] === "new") crumbs.push({ label: "New" });
  else if (rest[0]) crumbs.push({ label: rest[0].length > 14 ? `${rest[0].slice(0, 8)}…` : rest[0] });
  return crumbs;
}

/** App shell for every merchant dashboard screen: collapsible sidebar on the
 *  left, glass header with breadcrumbs and ⌘K, animated page transitions. */
export function DashboardLayout() {
  const crumbs = useCrumbs();
  const { pathname } = useLocation();
  // SidebarProvider writes this cookie when the sidebar is toggled; read it
  // back so a collapsed sidebar stays collapsed after a refresh.
  const defaultOpen = !document.cookie.includes("sidebar_state=false");
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <a
        href="#main"
        className="sr-only bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>
      <AppSidebar />
      <SidebarInset className="bg-ambient">
        <header className="dark sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b-2 border-b-[#c8102e] bg-[var(--bg-header)] px-4 text-[var(--on-dark)]">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((crumb, i) => (
                <Fragment key={`${crumb.label}-${i}`}>
                  {i > 0 ? <BreadcrumbSeparator /> : null}
                  <BreadcrumbItem>
                    {crumb.to ? (
                      <BreadcrumbLink render={<Link to={crumb.to} />}>{crumb.label}</BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage className="font-medium">{crumb.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2">
            <CommandMenu />
            <ThemeToggle />
          </div>
        </header>
        <ClickSpark sparkColor="var(--primary)" sparkSize={8} sparkRadius={18} sparkCount={8} duration={400}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.main
              key={pathname}
              id="main"
              tabIndex={-1}
              initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 pb-24 md:p-6 md:pb-8 lg:p-8 outline-none"
            >
              <Outlet />
            </motion.main>
          </AnimatePresence>
        </ClickSpark>
      </SidebarInset>
      <AssistantPanel />
    </SidebarProvider>
  );
}
