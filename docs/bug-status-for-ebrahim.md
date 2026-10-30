# BUGS — handover list for Ebrahim

Every known bug, where it is, why it happens, and its state. Full write-ups (root cause, who is
affected, options, proof) are in `docs/bugs/BUG-NNN-*.md` on the branch that fixes it.
The deeper analysis behind each row is in `docs/challenge/ANALYSIS.md` (IDs in brackets).

Money is integer fils (1 BD = 1000). The business day is midnight Asia/Bahrain.

**State**
- ✅ **merged** — on `main`, tested.
- 🟡 **fix ready** — committed on a `fix/*` branch with a failing-then-passing test and a write-up.
  Not yet reviewed or merged. Review the diff, run the suite, merge.
- 🟠 **half done** — work started but not committed, in the branch's worktree
  (`git worktree list` shows the folder). Finish or redo.
- ⬜ **open** — nobody has started it.

**Branches**
| Branch | Contents |
|---|---|
| `fix/checkout` | payment-link checkout: expiry, double charge, capture fee, hot-path indexes |
| `fix/money-settlement` | Go settlement and money maths |
| `fix/webhooks-reports` | acquirer callbacks, outbound webhooks, reports, fee display |

To review a branch: `git log --oneline main..fix/checkout`, `git diff main...fix/checkout`, then run
`npm run test:isolated` and `cd apps/settlement && go test ./...`. Branches don't depend on each
other; merge in any order. They are local — push them first if you work from another machine
(`git push origin fix/checkout fix/money-settlement fix/webhooks-reports`).

---

## Already fixed on `main`

| Bug | What | Root cause |
|---|---|---|
| — (CORS) | Browser could not log in to either dashboard | The API had no CORS handling; the preflight `OPTIONS` got 404. Comment claiming "CORS is locked in config" was false. Test: `apps/api/src/plugins/cors.new.test.ts` |
| DEP-002 | Fresh database can't be migrated | Abandoned v2 migration 0054 read a table nothing creates (team fix) |
| — (reporting) | Dashboards froze forever | One outbox event without `merchantId` made every pass roll back and retry it. Now skipped and logged. Test: `apps/reporting/src/consumer/poisonEvent.new.test.ts` |

## Security — being fixed by Sayed (not yours)

Login without OTP (BUG-001), OTP bound to another shop's user (BUG-002), cancel another shop's link
(BUG-003), impersonation with owner powers (BUG-010), OTP brute force + `Math.random` (BUG-011),
old API key still valid after rotation (BUG-012), credit self-approval (BUG-013), OTP returned in
the login reply outside production (BUG-031), and anything else the security review finds.

---

## Checkout and payments

| Bug | State | Symptom | Root cause | Where |
|---|---|---|---|---|
| BUG-004 | 🟡 `fix/checkout` | Expired payment link still payable | Expiry checked against the **client-sent** `submittedAt` | `api/paymentLinks/pay.ts` |
| BUG-005 | 🟡 `fix/checkout` (+ 🟠 replay follow-up uncommitted) | Link charged twice (incident 2026-05-14) | 60 s reservation expires during a slow capture; a 2nd payer re-claims; the loser's finalize matches 0 rows but returns 200. No DB guard exists (postmortem's "FP-202 done" is false) | `api/paymentLinks/pay.ts`, migration |
| BUG-036 | 🟡 `fix/checkout` | Ledger fee ≠ batch fee for merchants with a negotiated discount | Capture ignored the discount; settlement applied it | `api/payments/capture.ts` |
| BUG-037 | 🟡 `fix/checkout` | Daily volume metric on the wrong day | Bucketed by UTC date (`toISOString().slice(0,10)`) | `api/payments/capture.ts` |
| BUG-038 | 🟡 `fix/checkout` | Capture slows down as tables grow | Lookups every capture runs had no index | migration |

## Money and settlement (Go)

| Bug | State | Symptom | Root cause | Where |
|---|---|---|---|---|
| BUG-015 | 🟡 `fix/money-settlement` | Scheme statement a few fils **higher** than ours | Amount stored as float into `NUMERIC(10,2)`, which **rounds** (93.275 → 93.28) while `amount_fils` truncates | `stl/settlement/scheme_export.go` |
| BUG-041 | 🟡 `fix/money-settlement` | Rounding residue never booked | ADR-0002 says CloseBatch journals it; it never did | `stl/settlement/batch.go` |
| BUG-016 | 🟡 `fix/money-settlement` | Marketplace split children don't add up to the parent | Each child rounded on its own; leftover fils never paid | `stl/splits/allocate.go` |
| BUG-017 | 🟡 `fix/money-settlement` | Admin "Rebuild balances" ≠ CLI (Alpha 135K → 7K) | Button reads scheme lines (a view), CLI reads the ledger | `stl/internalapi/server.go`, `stl/ledger/` |
| BUG-018 | 🟡 `fix/money-settlement` | MDR recalculation changes batches already paid out | Filter `status <> 'open'` includes `paid` | `stl/settlement/recalculate_mdr.go` |
| BUG-020 | 🟡 `fix/money-settlement` | Daily close at 03:00 Bahrain, not midnight | "Today" taken from the UTC calendar day | `stl/settlement/window.go`, `stl/scheduler/daemon.go` |
| BUG-021 | 🟡 `fix/money-settlement` | Net payout off on big batches | Computed through `float32` | `stl/settlement/payable.go` |
| BUG-022 | 🟡 `fix/money-settlement` | Platform volume counter wraps past 2.1M BD | `INTEGER`/int32 column | `stl/settlement/platform_volume.go`, migration |
| BUG-028 | 🟡 `fix/money-settlement` | Lifetime payout estimate drifts for high-volume merchants | Accumulated in `REAL`/float32 | `stl/settlement/payout_estimate.go`, migration |
| BUG-008 | 🟠 half done in `fix/money-settlement` worktree | `settlement.paid` sent twice, two disbursement records (incident 2026-08-21) | Check-then-insert with no unique key; disbursement row per delivery | `stl/settlement/payout_notify.go`, `api/webhooks/payoutDisbursement.ts`, migration 0079 (uncommitted) |
| BUG-019 | ⬜ | Test merchants appear in the real settlement run | "Recompute statuses" clears `test_mode` when "open authorizations" = 0, and the counter excludes `authorized`, so it is always 0 | `api/admin/merchantFlags.ts` |
| BUG-014 | ⬜ | CSV import: "4.755" → 4.750, "4.75" → 0.475 | Parses with 2 decimals (`parseDecimalMinor(raw, 2)`) instead of `parseBhdToFils`; an existing test asserts the bug | `api/admin/adjustmentCsvParsing.ts`, `api/lib/decimal.ts` |
| BUG-027 | ⬜ | March sweep doubles the gap when run twice | Not idempotent (new random entry group each run, no existing-posting check), UTC month instead of Bahrain, debits the wrong account vs ADR-0002 | `scripts/reconcile_march.ts` (read only — never run it against a real DB) |
| BUG-009 | ⬜ | `expire_holds` deletes **every** hold when nothing expired | Empty filter list is skipped → `DELETE FROM holds` with no `WHERE`; holds must be flipped to `expired`, never deleted | `scripts/expire_holds.ts`, `scripts/lib/sqlFilter.ts` |
| BUG-029 | ⬜ | Same adjustment CSV imported twice posts twice | No duplicate guard | `api/admin/adjustmentImport.ts`, migration |
| BUG-042 | ⬜ | Split child payout silently does nothing | `merchant_balances` update without upsert; children have no row | `stl/balances/cache.go` |

## Webhooks, callbacks, reports

| Bug | State | Symptom | Root cause | Where |
|---|---|---|---|---|
| BUG-006 | 🟡 `fix/webhooks-reports` | Duplicate acquirer callback applied twice | No dedupe (`processed_events` never existed; FP-201 "fixed" is false) | `api/acquirer/callbacks.ts`, migration |
| BUG-007 | 🟡 `fix/webhooks-reports` | Forged/unsigned acquirer callbacks accepted | Signature optional by default, verified over re-serialised JSON, no freshness, non-constant-time compare, `outcome` not validated | `api/webhooks/inboundVerify.ts`, `api/routes/acquirerCallbacks.ts` |
| BUG-023 | 🟡 `fix/webhooks-reports` | Merchants can't verify our webhook signatures | Signs `canonicalJson(payload)`, sends `JSON.stringify(row.payload)` — different bytes | `api/webhooks/dispatcher.ts`, `sign.ts` |
| BUG-051 | 🟡 `fix/webhooks-reports` | Two API replicas send each webhook twice | Due deliveries selected without `FOR UPDATE SKIP LOCKED` | `api/webhooks/dispatcher.ts` |
| BUG-052 | 🟡 `fix/webhooks-reports` | Retry schedule random; its test fails | ±10% jitter on by default | `api/webhooks/dispatcher.ts` |
| BUG-053 | 🟡 `fix/webhooks-reports` | Deliveries stuck forever, log spam every 5 s | Undecryptable endpoint secret skipped each pass, never marked failed | `api/webhooks/dispatcher.ts` |
| BUG-024 | 🟡 `fix/webhooks-reports` | Settlement summary +38% for multi-capture merchants; slow | Sums the transaction's running `captured_fils` once per capture event | `api/settlement/query.ts` |
| BUG-026 | 🟡 `fix/webhooks-reports` | Dashboard shows 245 bps, payments charge 225 | Shows the latest-entered schedule, not the one in effect now | `api/fees/currentFeeScheduleDisplay.ts` |
| BUG-054 | 🟡 `fix/webhooks-reports` | Reconciliation pending figure uses the wrong rate | Uses `merchants.mdr_bps` ("kept in sync by a trigger" — none exists) | `api/settlement/query.ts` |
| BUG-025 | ⬜ | CSV export can OOM the 512 MB API; streaming version skips rows | Route uses the in-memory builder (CHANGELOG says streaming); streaming keyset is on `occurred_at` only, not `(occurred_at, id)` | `api/transactions/exportCsv.ts`, `api/routes/transactions.ts` |
| BUG-030 | ⬜ | CSV export formula injection | Cells starting `= + - @` not neutralised | `api/transactions/exportCsv.ts` |
| BUG-055 | ⬜ | Reports and analytics on the wrong day after 21:00 UTC | Bucketed by UTC / server-local date, not Bahrain | `apps/reporting/src/consumer/applyEvent.ts`, `api/analytics/query.ts` |

## Refunds (unfinished feature FP-300)

| Bug | State | Symptom | Root cause | Where |
|---|---|---|---|---|
| BUG-056 | ⬜ | Every refund fails (11 failing tests) | Code inserts an explicit `NULL` reason; the column default only applies when the column is omitted, so `chk_refunds_reason_not_null` fires | `api/payments/processRefund.ts` |
| BUG-057 | ⬜ | Two parallel refunds both succeed | Validated in one transaction, journaled in a second without re-checking; lost update on `refunded_fils` | `api/payments/processRefund.ts` |
| BUG-058 | ⬜ | Refund more than was captured | Refundable = authorized − refunded instead of captured − refunded | `api/payments/refundValidation.ts` |
| BUG-059 | ⬜ | Refund another merchant's transaction | Transaction looked up by id only | `api/payments/processRefund.ts`, `api/refunds/` |
| BUG-060 | ⬜ | Status stays `partially_captured` after a full refund | State machine misses the case | `api/payments/refundState.ts` |
| BUG-043 | ⬜ | Fee reversed across partial refunds can exceed the original fee | Each partial rounded on its own | `packages/money` `calculateRefundFee` |
| — | ⬜ | Refund summary report wrong | Migration 0072 view joins `t.id = r.id` instead of `r.transaction_id` | new migration |
| — | ⬜ | Route returns 501; no `refund.succeeded` webhook; settlement never subtracts refunds | Feature never wired | `api/routes/refunds.ts`, `api/webhooks/envelope.ts`, `stl/settlement/batch.go` |

## Smaller

| Bug | State | What |
|---|---|---|
| — | ⬜ | `/readyz` never re-checks the database after boot (being handled in the availability work) |
| — | ⬜ | Settlement daemon runs a close at boot before its delay check (S10) |
| — | ⬜ | Balance rebuild races a concurrent CloseBatch, no lock (S11) |
