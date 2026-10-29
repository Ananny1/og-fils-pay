import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";
import "../dashboard.css";

/** Unknown URL: a plain sentence and a way back, instead of the router's
 *  default developer error screen. */
export function NotFoundPage() {
  return (
    <main className="dash-centered">
      <h1>Page not found</h1>
      <p className="dash-muted">There is no page at this address.</p>
      <p>
        <Link to="/dashboard">Go to the dashboard</Link>
      </p>
    </main>
  );
}

/** `errorElement` for every route: a render error or an unmatched route lands
 *  here instead of a blank page or a stack trace. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPage />;
  }
  return (
    <main className="dash-centered">
      <h1>Something went wrong</h1>
      <p className="dash-error">This page could not be shown. Please reload, or go back to the dashboard.</p>
      <p>
        <Link to="/dashboard">Go to the dashboard</Link>
      </p>
    </main>
  );
}
