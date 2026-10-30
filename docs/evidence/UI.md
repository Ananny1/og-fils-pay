# UI and UX: before and after

Every image shows the same screen before (left) and after (right), captured by the same headless
browser script against the same seeded data (`docs/evidence/tools/shots.mjs`, then `compare.mjs`).
Light theme, 1440×900 unless noted.

| Screen | Image |
|---|---|
| Merchant sign-in / welcome | [web-login](ui/web-login.jpg) · [case dossier, scrolled](ui/web-login-dossier.jpg) |
| Transactions | [web-transactions](ui/web-transactions.jpg) |
| Payouts (settlement batches) | [web-payouts](ui/web-payouts.jpg) |
| Payouts on a phone (390 px) | [web-mobile-payouts](ui/web-mobile-payouts.jpg) |
| Reconciliation | [web-reconciliation](ui/web-reconciliation.jpg) |
| Overview | [web-overview](ui/web-overview.jpg) |
| Checkout (link not found state) | [web-checkout-notfound](ui/web-checkout-notfound.jpg) |
| Admin sign-in | [admin-login](ui/admin-login.jpg) |
| Admin merchants | [admin-merchants](ui/admin-merchants.jpg) |
| Admin merchant detail | [admin-merchant-detail](ui/admin-merchant-detail.jpg) |
| Admin settlement ops | [admin-settlement](ui/admin-settlement.jpg) |

The "before" column is the redesigned shadcn dashboard (already a step up from the original
unstyled HTML); the very first state of the app — plain HTML tables, top nav, browser-local dates
like `8/31/2026, 3:00:00 PM` — is described below.

## What changed and why it matters to users

| Problem in the original | Change | Why |
|---|---|---|
| Opening the site root showed React Router's "Hey developer 👋 404" page | `/` redirects to the dashboard; designed "page not found" / "something went wrong" pages | A merchant must never see a developer error |
| The browser could not log in at all (no CORS) | CORS for the two dashboard origins only | Unblocked every page |
| Top navigation with seven links; no hierarchy | Collapsible sidebar grouped Activity / Money / Developers, role-aware, ⌘K command menu | Faster to find things; hides what a role can't use |
| Dates in the viewer's own timezone and US format | All times in Asia/Bahrain, `31 Aug 2026, 15:00`; business dates `Mon, 31 Aug 2026` | Payouts close at Bahrain midnight; dates must match the business day |
| Amounts as plain text | Monospace, right-aligned, thousands separators, always 3 decimals, `BHD` suffix | Fils line up in columns; 1 BD = 1000 fils is never shown as 2 decimals |
| Jargon: "ledger merchant payable", "scheme export lines", "To (exclusive)" | Plain words: "You earned", "Paid to your bank", "Before" | Merchants aren't accountants |
| "Load more" button only | Numbered pages, 10/15/25 per page | Predictable navigation |
| Status as row of chips | Multi-select dropdown; statuses as stamps (red = needs attention, ink = settled) | Scannable at a glance |
| `window.confirm` for void/cancel/delete | Confirmation dialogs that name the consequence | Fewer accidental money actions |
| No loading / empty / error design | Skeletons, empty states with next step, red error banners with a sentence | Never a blank page or raw JSON |
| — | "Ask FilsPay" assistant and "this payout in plain words" | Answers the most common support question ("why this amount?") from the shop's own data |

## Theme: "confidential case file"

One theme file (`packages/theme/case-file.css`) for both apps: paper `#F4F1EA`, charcoal header
`#1E1E1E`, crimson `#C8102E` used sparingly (key numbers, stamps, primary buttons, section rules);
Oswald headlines, IBM Plex Mono labels and tables, Inter body, Caveat for decorative notes. Contrast
ratios are documented in the file (all text pairs pass WCAG AA; red is lightened in dark mode where
the brief's crimson would fail AA). The checkout uses the theme lightly — plain paper, no stamps —
because a customer paying must trust the page; the admin console uses it fully.
