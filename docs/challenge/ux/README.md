# UX evidence: before and after

Screenshots of the three apps the judges look at: **checkout** (`/pay/<token>`), the **merchant
dashboard** (`http://localhost:5173/dashboard`) and the **admin console** (`http://localhost:5174`).

- `before/` was taken on 2026-10-30 from the running local stack (seed data), before any UI fix.
- `after/` is taken by the organiser after the UI fixes are merged.

How they were taken: a small Playwright script (headless Chromium 1280x800, checkout at phone
width 420x860) that logs in through the real login screens (merchant
`owner@deltawholesale.example`, admin `superadmin@filspay.test`, OTP read from the dev code on
screen), creates **one** payment link (12.345 BD, reference `UX-0 screenshot`) for the checkout
shot, and starts and then ends one "view as merchant" grant.

## Before

| # | Page | URL | What's wrong on it |
|---|------|-----|--------------------|
| 01 | Merchant login | `/dashboard/login` | Tab title says **"FilsPay Checkout"** on every dashboard page (F9). Raw Merchant ID UUID field. |
| 02 | Merchant login, OTP step | `/dashboard/login` | Same tab title. OTP step works; dev code shown (local only). |
| 03 | Transactions list | `/dashboard/transactions` | Amounts are 3 decimals (OK). Times are browser-local, not Bahrain (F7). Tab title wrong. |
| 04 | Transaction detail | `/dashboard/transactions/:id` | No refund action at all (F1); empty event timeline for seed rows; capture/void buttons only on authorized rows, not guarded against double clicks (F10). |
| 05 | Overview | `/dashboard/overview` | Tab title wrong. |
| 06 | Payment links list | `/dashboard/payment-links` | Tab title wrong. |
| 07 | New payment link | `/dashboard/payment-links/new` | Tab title wrong. |
| 08 | Payment link detail | `/dashboard/payment-links/:id` | Tab title wrong. |
| 09 | Settlement batches | `/dashboard/settlement` | Tab title wrong. |
| 10 | Settlement batch detail | `/dashboard/settlement/:id` | Progress bar computed as `grossFils / 10000` (a money figure used as a percent, meaningless). Note says scheme amount "quantized to two decimal places ... by design" (claim to verify, BUG register). |
| 11 | Reconciliation | `/dashboard/reconciliation` | `bhd()` helper calls `toFils` without `allowNegative`, so a negative gap would crash the page instead of showing `-x.xxx BHD` (F5). |
| 12 | Webhooks list | `/dashboard/webhooks` | Tab title wrong. |
| 13 | New webhook | `/dashboard/webhooks/new` | Tab title wrong. |
| 14 | Not found | `/dashboard/nope` | Works (F0). Tab title wrong. |
| 15 | Checkout | `/pay/<token>` | Tab title "FilsPay Checkout" is right here only. Expiry-month box squashed at phone width. Amount 3 decimals (OK). |
| 16 | Checkout, bad token | `/pay/not-a-real-token` | Plain "Payment link not found", OK. |
| 17 | Admin login | `/login` | Tab title "FilsPay Admin" on every admin page, no page name (F9). |
| 18 | Admin login, OTP step | `/login` | Same. |
| 19 | Admin merchants list | `/merchants` | Same tab title. |
| 20 | Admin merchant detail | `/merchants/:id` | Many money buttons on one page (adjust balance, issue credit, KYC, rotate key, recompute): check each is disabled while pending (F10). |
| 21 | Admin credits | `/credits` | Approve / reject buttons: double-click check (F10). |
| 22 | Admin settlement ops | `/settlement` | Run batch / rebuild buttons: double-click check (F10). |
| 23 | Admin adjustment imports | `/adjustment-imports` | Import button: double-click check (F10). |
| 24 | Admin webhook replay | `/webhooks` | Same tab title. |
| 25 | Admin, impersonation active | `/merchants/:id` | Admin banner is clear, but it says nothing about **read-only**. |
| 26-27 | "View as merchant" in the dashboard | `/dashboard/transactions`, `/dashboard/payment-links` | **Broken:** with only the impersonation grant, the dashboard bounces to the merchant **login page** (it asks `/v1/auth/me`, which only knows merchant sessions). When the same browser also holds a merchant session, the dashboard shows that user's role and every write button with **no banner** at all (F4). |
