import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useDashboardAuth } from "./DashboardAuthContext.js";

/**
 * Route guard: renders its children only once `GET /v1/auth/me` has
 * confirmed a live merchant session, and sends the user to
 * `/dashboard/login` otherwise (remembering where they were headed).
 *
 * This is navigation, not authorization — the dashboard's data is behind
 * the API's own `requireMerchantAuth` preHandler, which answers `401` to an
 * unauthenticated request no matter what this app renders.
 */
export function RequireDashboardAuth({ children }: { children: ReactNode }) {
  const { status } = useDashboardAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <main className="flex min-h-svh items-center justify-center gap-3 text-sm text-muted-foreground">
        <Spinner /> Checking your session…
      </main>
    );
  }

  if (status === "anonymous") {
    return <Navigate to="/dashboard/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}
