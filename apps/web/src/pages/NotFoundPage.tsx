import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** Route-level error boundary: a designed page instead of React Router's
 *  default "Hey developer" screen. */
export function NotFoundPage() {
  const error = useRouteError();
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Compass />
          </EmptyMedia>
          <EmptyTitle>{is404 ? "Page not found" : "Something went wrong"}</EmptyTitle>
          <EmptyDescription>
            {is404 ? "That address doesn't exist in the dashboard." : "The page hit an unexpected error. Try again from the dashboard."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link to="/dashboard" />}>Go to dashboard</Button>
        </EmptyContent>
      </Empty>
    </main>
  );
}
