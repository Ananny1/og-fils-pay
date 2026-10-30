import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";
import { Compass, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

function Screen({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Empty className="max-w-md border border-[var(--card-border)] bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
          <EmptyTitle className="font-heading text-xl uppercase">{title}</EmptyTitle>
          <EmptyDescription>{body}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link to="/dashboard" />}>Go to the dashboard</Button>
        </EmptyContent>
      </Empty>
    </main>
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
