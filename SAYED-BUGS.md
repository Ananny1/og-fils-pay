# Sayed — bugs we fixed

Every bug in the handed-over app that was fixed in Sayed's sessions (problems we introduced ourselves are not listed). Each has a failing-then-passing test; numbered bugs also have a
full write-up in `docs/bugs/<ID>-*.md` (root cause, who was affected, options, proof).

**On `main`** = merged and verified (full suite + Go suite green apart from the 12 known refund /
retry-timing failures, whose fixes are on `fix/*` branches below).
**On branch** = fixed and committed on that branch, not yet reviewed/merged into `main`.

## Security — on `main`

| ID | Bug | Root cause | Fix |
|---|---|---|---|
| BUG-001 | Login worked without the OTP | `lookupSession` read `live_sessions`, which never checks `authenticated = true` | Require `authenticated = true` |
| BUG-002 | OTP logged you into another shop with the same email | OTP recipient re-looked-up by email across all merchants (`LIMIT 1`) | Bind the OTP to the exact user whose password was checked |
| BUG-003 | Shop A could cancel shop B's payment link | Cancel updated by link id only | Scope read + update to the caller's merchant (404 otherwise) |
| BUG-010 | "View as merchant" had owner powers | super_admin mapped to `owner`; nothing blocked writes | Every grant is read-only `support`; non-GET refused; disabled admins lose grants |
| BUG-011 | OTP brute force in parallel; guessable OTPs | Read-then-increment attempt counter; resend reset it; `Math.random` codes | One conditional UPDATE spends the attempt; count survives resend; `crypto.randomInt` |
| BUG-012 | Old API key still worked after rotation | Rotation never revoked it; verify ignored `revoke_after` | Revoke on rotation; verify honours `revoke_after` |
| BUG-013 | Admin could approve their own credit | Two-person check compared display names | Compare admin user ids |
| BUG-031 | OTP code returned in the login reply and logged | `otpDevExpose` on whenever `NODE_ENV` ≠ production (unset counts) | Off by default; dev opts in with `OTP_DEV_EXPOSE=true` |
| BUG-032 | Merchant session dropped after 10 minutes | OTP verify never re-set the cookie, so the 10-min pending Max-Age stayed | Re-set the cookie at full session lifetime |
| BUG-033 | Bulk KYC approve approved rejected / document-less shops | No status filter; no review row written | Only `under_review` moves; review row per merchant |
| BUG-034 | Any merchant could read another merchant's split-child report | Report scope accepted any split child | Require the caller to be the child's parent |
| BUG-035 | A support admin could post credits alone | Create-credit route had no role check | Require finance or super_admin |
| CORS | Browser couldn't log in to either dashboard | API had no CORS; preflight got 404 (comment "CORS is locked in config" was false) | CORS for the two dashboard origins only (`plugins/cors.ts`) |

## Availability and capacity — on `main`

| ID | Problem | Root cause | Fix |
|---|---|---|---|
| OPS-001 | `/readyz` said "ready" with the database down | Boot-time latch, never re-checked | Live DB check on every call |
| OPS-002 | Overload queued up until requests timed out | No cap on in-flight work, no DB/request limits | Shed excess immediately with 503 + Retry-After; statement and body limits |
| OPS-003 | Restarts could cut in-flight payments | No graceful shutdown | Drain in-flight requests, then close the pool (API + settlement) |
| OPS-004 | No reproducible secure deploy for 1 vCPU / 2 GB | Dev-only compose; DB and internal API exposed | Production stack: nginx entry, limits, restarts, healthchecks, nothing internal published |
| OPS-005/006 | No capacity number | — | k6 checkout load test; estimate ≈35 checkouts/s at ≈30 concurrent payers, p95 < 1 s (`docs/ops/CAPACITY.md`) |
| — (reporting) | Dashboards froze forever | One outbox event without `merchantId` made every pass roll back and retry it | Skip and log such events |

## Money, checkout, webhooks — fixed on branches (not yet merged)

| Branch | Bugs |
|---|---|
| `fix/checkout` | BUG-004 expired link payable · BUG-005 link charged twice · BUG-036 capture fee ignored the discount · BUG-037 UTC-dated metric · BUG-038 hot-path indexes (needed for the capacity number) |
| `fix/money-settlement` | BUG-015 scheme file a few fils high · BUG-041 rounding residue never booked · BUG-016 split payouts don't add up · BUG-017 balance rebuild 135K → 7K · BUG-018 MDR recalc rewrote paid batches · BUG-020 close at 03:00 not midnight · BUG-021 float32 net · BUG-022 int32 overflow · BUG-028 drifting payout estimate |
| `fix/webhooks-reports` | BUG-006 duplicate callbacks · BUG-007 unsigned/forged callbacks accepted · BUG-023 webhook signed different bytes than sent · BUG-051 double-send with two replicas · BUG-052 random retry schedule · BUG-053 undecryptable secret retried forever · BUG-024 summary double-counts · BUG-026 245 vs 225 bps · BUG-054 reconciliation uses wrong rate |


## Round 2 (30 Oct 2026, evening): 38 more bugs from the original code

Every bug below was already in the handed-over code (challenge commit `8b58b0f`); each write-up names
the file and line there. Each fix started with a test that failed on the old code for the stated reason
and passes after it. Duplicates of bugs Ebrahim or another agent had already fixed were dropped.
Full suites on the merged code: API 637/637, reporting 17/17, Go all packages, web 44/44, admin 14/14,
type check clean.

| Bug | What was wrong | Where in the original | Write-up | Old number |
|---|---|---|---|---|
| BUG-064 | A posted manual credit is never paid out | `apps/settlement/internal/settlement/batch.go:219` | [BUG-064-manual-credit-never-paid-out.md](docs/bugs/BUG-064-manual-credit-never-paid-out.md) | BUG-070 |
| BUG-065 | MDR recalculation ignores the merchant's fee schedule | `apps/settlement/internal/settlement/recalculate_mdr.go:142,157` | [BUG-065-mdr-recalc-ignores-fee-schedule.md](docs/bugs/BUG-065-mdr-recalc-ignores-fee-schedule.md) | BUG-071 |
| BUG-066 | MDR recalculation drops the platform volume-tier discount | `apps/settlement/internal/settlement/recalculate_mdr.go:157` | [BUG-066-mdr-recalc-drops-volume-tier-bonus.md](docs/bugs/BUG-066-mdr-recalc-drops-volume-tier-bonus.md) | BUG-072 |
| BUG-067 | One failing merchant stops the whole daily settlement run | `apps/settlement/internal/settlement/batch.go:439,448,455,461` | [BUG-067-one-merchant-failure-blocks-daily-run.md](docs/bugs/BUG-067-one-merchant-failure-blocks-daily-run.md) | BUG-073 |
| BUG-068 | After an MDR recalculation the merchant dashboard keeps the old payout figures | `apps/settlement/internal/settlement/recalculate_mdr.go:109` | [BUG-068-mdr-recalc-reporting-keeps-old-figures.md](docs/bugs/BUG-068-mdr-recalc-reporting-keeps-old-figures.md) | BUG-074 |
| BUG-069 | A merchant `support` user can capture or void payments | `apps/api/src/routes/transactions.ts:95` | [BUG-069-support-can-capture-and-void.md](docs/bugs/BUG-069-support-can-capture-and-void.md) | BUG-075 |
| BUG-070 | A suspended or closed merchant can still charge cards with its API key | `apps/api/src/apiKeys/verify.ts:19` | [BUG-070-suspended-merchant-api-key-works.md](docs/bugs/BUG-070-suspended-merchant-api-key-works.md) | BUG-076 |
| BUG-071 | Adjustment CSV with a wrong merchant id crashes with 500 | `apps/api/src/admin/adjustmentImport.ts:68` | [BUG-071-adjustment-import-unknown-merchant-500.md](docs/bugs/BUG-071-adjustment-import-unknown-merchant-500.md) | BUG-077 |
| BUG-072 | Staff logout leaves the "view as merchant" grant working | `apps/api/src/routes/adminAuth.ts:212` | [BUG-072-admin-logout-keeps-impersonation.md](docs/bugs/BUG-072-admin-logout-keeps-impersonation.md) | BUG-078 |
| BUG-073 | A capture Idempotency-Key reused on another transaction says "captured" but captures nothing | `apps/api/src/payments/capture.ts:92` | [BUG-073-capture-key-reused-on-another-transaction.md](docs/bugs/BUG-073-capture-key-reused-on-another-transaction.md) | BUG-080 |
| BUG-074 | A bad amount on authorize or capture crashes with a 500 | `apps/api/src/routes/transactions.ts:79` | [BUG-074-bad-amount-on-authorize-capture-500.md](docs/bugs/BUG-074-bad-amount-on-authorize-capture-500.md) | BUG-081 |
| BUG-075 | A failed capture at checkout leaves the payer's authorization open | `apps/api/src/paymentLinks/pay.ts:128` | [BUG-075-checkout-capture-failure-leaves-open-authorization.md](docs/bugs/BUG-075-checkout-capture-failure-leaves-open-authorization.md) | BUG-082 |
| BUG-076 | Creating a payment link for 0 fils crashes with a 500 | `apps/api/src/paymentLinks/create.ts:38` | [BUG-076-zero-fils-payment-link-500.md](docs/bugs/BUG-076-zero-fils-payment-link-500.md) | BUG-083 |
| BUG-077 | Capturing the rest of a sale after a partial refund shows it as plain "captured" | `apps/api/src/payments/capture.ts:198` | [BUG-077-capture-after-partial-refund-shows-captured.md](docs/bugs/BUG-077-capture-after-partial-refund-shows-captured.md) | BUG-084 |
| BUG-078 | Deleting a webhook endpoint that has deliveries returns 500 | `apps/api/src/webhooks/cancel.ts:22` | [BUG-078-webhook-endpoint-delete-500.md](docs/bugs/BUG-078-webhook-endpoint-delete-500.md) | BUG-085 |
| BUG-079 | A disabled webhook endpoint keeps receiving deliveries | `apps/api/src/webhooks/dispatcher.ts:223-224` | [BUG-079-disabled-webhook-endpoint-still-receives.md](docs/bugs/BUG-079-disabled-webhook-endpoint-still-receives.md) | BUG-086 |
| BUG-080 | Admin "replay batch" sends the same webhook event twice | `apps/api/src/webhooks/replayBatch.ts:80` | [BUG-080-batch-replay-sends-events-twice.md](docs/bugs/BUG-080-batch-replay-sends-events-twice.md) | BUG-087 |
| BUG-081 | Restoring a webhook archive sends the same event several times | `apps/api/src/webhooks/archiveReplay.ts:144` | [BUG-081-archive-restore-duplicates-events.md](docs/bugs/BUG-081-archive-restore-duplicates-events.md) | BUG-088 |
| BUG-082 | Transaction report date filter uses the UTC day, not the Bahrain day | `apps/api/src/reporting/transactionsReportQuery.ts:49` | [BUG-082-report-dates-use-utc-day.md](docs/bugs/BUG-082-report-dates-use-utc-day.md) | BUG-089 |
| BUG-083 | Staff "Adjust balance" reads "50.000" as 50 fils | `apps/admin/src/pages/merchants/MerchantDetailPage.tsx:118` | [BUG-083-admin-balance-adjust-reads-bd-as-fils.md](docs/bugs/BUG-083-admin-balance-adjust-reads-bd-as-fils.md) | BUG-090 |
| BUG-084 | Credit form defaults to the browser's day, not Bahrain's | `apps/admin/src/pages/merchants/MerchantDetailPage.tsx:19` | [BUG-084-credit-effective-date-browser-day.md](docs/bugs/BUG-084-credit-effective-date-browser-day.md) | BUG-091 |
| BUG-085 | Webhook replay window is read in the browser's time zone | `apps/admin/src/pages/webhooks/WebhookReplayPage.tsx:24` | [BUG-085-webhook-replay-window-browser-zone.md](docs/bugs/BUG-085-webhook-replay-window-browser-zone.md) | BUG-092 |
| BUG-086 | Retrying a failed partial capture can capture twice | `apps/web/src/pages/transactions/TransactionDetailPage.tsx:77` | [BUG-086-capture-retry-new-idempotency-key.md](docs/bugs/BUG-086-capture-retry-new-idempotency-key.md) | BUG-093 |
| BUG-087 | Bulk "Approve KYC" also approves merchants no longer on screen | `apps/admin/src/pages/merchants/MerchantListPage.tsx:90` | [BUG-087-bulk-kyc-approves-hidden-selection.md](docs/bugs/BUG-087-bulk-kyc-approves-hidden-selection.md) | BUG-094 |
| BUG-088 | Closing today's batch from the admin console loses the rest of today's sales | `apps/api/src/routes/admin.ts:118` | [BUG-088-close-running-business-day.md](docs/bugs/BUG-088-close-running-business-day.md) | BUG-095 |
| BUG-089 | Retrying a refund after a lost answer refunds twice | `apps/web/src/pages/transactions/RefundDrawer.tsx:69` | [BUG-089-refund-retry-new-key.md](docs/bugs/BUG-089-refund-retry-new-key.md) | BUG-096 |
| BUG-090 | Payment-link list returns 500 for a non-numeric `?limit=` | `apps/api/src/routes/paymentLinks.ts:126` | [BUG-090-payment-link-list-bad-limit-500.md](docs/bugs/BUG-090-payment-link-list-bad-limit-500.md) | BUG-101 |
| BUG-091 | Payment-link list returns 500 for a malformed cursor | `apps/api/src/paymentLinks/query.ts:24-39` | [BUG-091-payment-link-bad-cursor-500.md](docs/bugs/BUG-091-payment-link-bad-cursor-500.md) | BUG-102 |
| BUG-092 | Cancelling a payment link with a non-UUID id returns 500 | `apps/api/src/paymentLinks/cancel.ts:16` | [BUG-092-cancel-link-bad-id-500.md](docs/bugs/BUG-092-cancel-link-bad-id-500.md) | BUG-103 |
| BUG-093 | Refund summary view is always empty | `db/migrations/0072_refund_merchant_summary.sql:14` | [BUG-093-refund-summary-always-empty.md](docs/bugs/BUG-093-refund-summary-always-empty.md) | BUG-110 |
| BUG-094 | Posted ledger entries can be edited, deleted, or left unbalanced | `db/migrations/0007_ledger_double_entry.sql:47-51` | [BUG-094-ledger-not-immutable.md](docs/bugs/BUG-094-ledger-not-immutable.md) | BUG-111 |
| BUG-095 | Two reporting passes at once count the same event twice | `apps/reporting/src/consumer/cursor.ts:32` | [BUG-095-reporting-concurrent-pass-double-count.md](docs/bugs/BUG-095-reporting-concurrent-pass-double-count.md) | BUG-130 |
| BUG-096 | Reporting skips an event whose transaction commits late | `apps/reporting/src/consumer/runConsumerPass.ts:45-53` | [BUG-096-reporting-skips-late-committing-events.md](docs/bugs/BUG-096-reporting-skips-late-committing-events.md) | BUG-131 |
| BUG-097 | An expired link left "reserved" shows as payable | `apps/api/src/paymentLinks/status.ts:40` | [BUG-097-stale-reserved-expired-link-shows-active.md](docs/bugs/BUG-097-stale-reserved-expired-link-shows-active.md) | BUG-160 |
| BUG-098 | Webhook sender follows redirects (SSRF via test-send) | `apps/api/src/webhooks/transport.ts:40` | [BUG-098-webhook-transport-follows-redirects.md](docs/bugs/BUG-098-webhook-transport-follows-redirects.md) | BUG-170 |
| BUG-099 | Webhook sender reads the receiver's whole reply into memory | `apps/api/src/webhooks/transport.ts:48` | [BUG-099-webhook-response-read-unbounded.md](docs/bugs/BUG-099-webhook-response-read-unbounded.md) | BUG-171 |
| BUG-100 | The operator who raised a credit is offered "Approve" on it | `apps/admin/src/pages/credits/CreditsPage.tsx:171-180` | [BUG-100-credit-requester-offered-approve.md](docs/bugs/BUG-100-credit-requester-offered-approve.md) | BUG-180 |
| BUG-101 | Merchant dashboard shows an expired payment link as "active" | `apps/web/src/pages/payment-links/PaymentLinkDetailPage.tsx:123` | [BUG-101-expired-link-shown-active.md](docs/bugs/BUG-101-expired-link-shown-active.md) | BUG-181 |
