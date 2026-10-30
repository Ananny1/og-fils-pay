import { useEffect } from "react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";
import { Compass, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { BrandMark } from "@/components/dashboard/public-shell";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";

function Screen({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  useEffect(() => {
    document.title = `${title} · FilsPay`;
    return () => {
      document.title = "FilsPay";
    };
  }, [title]);
  return (
    <div className="flex min-h-svh flex-col">
      {/* Same dark header strip as the login page, with the theme toggle. */}
      <header className="dark border-b-2 border-b-[#c8102e] bg-[var(--bg-header)] text-[var(--on-dark)]">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 md:px-6">
          <BrandMark />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <Empty className="max-w-md border border-[var(--card-border)] bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">{icon}</EmptyMedia>
            <EmptyTitle className="font-heading text-xl uppercase">
              {/* Preflight makes h1 inherit size and weight, so it keeps the title style. */}
              <h1>{title}</h1>
            </EmptyTitle>
            <EmptyDescription>{body}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link to="/dashboard" />}>Go to the dashboard</Button>
          </EmptyContent>
        </Empty>
      </main>
    </div>
  );
}

/** Unknown URL: a plain sentence and a way back, instead of the router's
 *  default developer error screen. */
export function NotFoundPage() {
  return <Screen icon={<Compass />} title="Page not found" body="There is no page at this address." />;
}

/** `errorElement` for every route: a render error or an unmatched route lands
 *  here instead of a blank page or a stack trace. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPage />;
  }
  return (
    <Screen
      icon={<TriangleAlert />}
      title="Something went wrong"
      body="This page could not be shown. Please reload, or go back to the dashboard."
    />
  );
}
