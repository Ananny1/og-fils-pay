# F0 — Dashboard home URL broken; no "not found" or error pages

| | |
|---|---|
| **Severity** | Medium (first thing a judge opens; looks broken) |
| **Area** | Frontend (`apps/web`, `apps/admin`) |
| **Analysis ID** | — (found while running the app) |
| **Clue** | Opening http://localhost:5173 shows the router's developer error screen |
| **Status** | ✅ fixed |

## 1. The issue

- `http://localhost:5173/` (the shop app's home) shows "Unexpected Application Error! 404 Not Found".
  The real pages all live under `/dashboard/...`, but nothing sends you there.
- Any mistyped address in either app (e.g. `/dashboard/nope`, `/merchantz`) shows the same developer error screen.
- If a page crashes while rendering, the user gets a blank page or a stack trace instead of a message.

## 2. Why it happened

`apps/web/src/router.tsx` has routes for `/pay/:token` and `/dashboard/...` only: no `/` route and
no catch-all `*`. Neither router (`apps/web/src/router.tsx`, `apps/admin/src/router.tsx`) sets an
`errorElement`, so React Router falls back to its built-in development error screen for both unknown
URLs and render errors.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants / staff | The home URL looks broken; a typo or crash leaves them stuck with no way back | Medium |
| FilsPay | Looks unfinished to customers and judges; a stack trace can reveal internals | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/web/src/router.tsx` | `/` redirects to `/dashboard` (which goes to login or transactions). `errorElement` on every top-level route; catch-all `*` → "Page not found". |
| `apps/admin/src/router.tsx` | `errorElement` on every top-level route; catch-all `*` → "Page not found". (`/` already redirects to `/merchants`.) |
| `apps/web/src/components/RouteErrorPage.tsx` | New: `NotFoundPage` and `RouteErrorPage` (a 404 shows "not found", anything else "Something went wrong"), with a link back. Uses the existing `dash-*` styles. |
| `apps/admin/src/components/RouteErrorPage.tsx` | Same for the staff console, `admin-*` styles. |

No API change. Existing pages and guards are untouched.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Redirect `/` + `errorElement` + catch-all `*` | Covers unknown URLs and crashes with React Router's own API; tiny | — | ✅ |
| 2 | Only add the `/` redirect | Smallest | Typos and crashes still show the dev screen | |
| 3 | Add a real landing page at `/` | Nicer marketing | New design work; not needed for the brief | |
| 4 | A React error boundary class around the app | Catches crashes | Duplicates what `errorElement` already does in a data router | |

## 6. Proof

| Check | Before | After |
|---|---|---|
| `npx tsc --noEmit` in `apps/web` and `apps/admin` | — | ✅ no errors |
| Open `http://localhost:5173/` | ❌ "Unexpected Application Error! 404" | ✅ goes to `/dashboard/login` (or transactions when logged in) |
| Open `http://localhost:5173/dashboard/nope`, `http://localhost:5174/nope` | ❌ developer error screen | ✅ "Page not found" + link back |

Automated route tests come with the frontend test work (PLAN Phase T).
