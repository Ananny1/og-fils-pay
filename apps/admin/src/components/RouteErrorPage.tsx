import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";

/** Unknown URL: a plain sentence and a way back, instead of the router's
 *  default developer error screen. */
export function NotFoundPage() {
  return (
    <main className="admin-centered">
      <h1>Page not found</h1>
      <p className="admin-muted">There is no page at this address.</p>
      <p>
        <Link to="/merchants">Go to merchants</Link>
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
    <main className="admin-centered">
      <h1>Something went wrong</h1>
      <p className="admin-error">This page could not be shown. Please reload, or go back to merchants.</p>
      <p>
        <Link to="/merchants">Go to merchants</Link>
      </p>
    </main>
  );
}
