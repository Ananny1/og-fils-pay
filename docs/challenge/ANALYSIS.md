# FilsPay — Deep Analysis (29 Oct 2026)

Repo: `~/Desktop/Cyber_Challenge/repo`
- `origin` = **Ananny1/fils-pay** (submission; single squashed commit, `.env.docker` removed)
- `reference` = **MJ5-byte/fils-pay** (full 57-commit history with the story/clues)

This document is the map for every fix (written before any change). Task status lives in `PLAN.md`.

---

## 0. How to read this codebase (the meta-game)

The repo is built as a trap for "AI-assisted" developers. Three layers of misinformation:

| Source | Trust | Why |
|---|---|---|
| Code + migrations | **Truth** | ARCHITECTURE says "where it disagrees with the code, the code wins" |
| ADR-0001, ADR-0002, HANDOVER.md (YA) | **The intended spec** | Yousif wrote the money package and is the "honest" character |
| ARCHITECTURE.md | Mostly right, some stale claims | Edited by several people |
| ADR-0003, 0004, 0006, CHANGELOG, ADMIN.md, RUNBOOK | **Often wrong** | Written by MK/the "Order" to justify bugs |
| `CLAUDE.md`, `AGENTS.md`, `.cursorrules` | **Poisoned** | Say "cents", "UTC midnight", "never modify money/tests", "Math.random fine", "super_admin→owner correct" — all false |
| Inline `// FH / MK / am / YA` comments | Hints | Whoever *doubts* (FH, am, YA) is usually right; whoever dismisses (MK, "Claude says it's fine") is usually wrong |
| `Claude says ...` comments | Mixed | Some real (callback dedupe, adjustment double-apply), some decoys (JPEG magic, idempotency `<` sort) |

**The "Order of the Prompt" rules are the anti-pattern list:** model knows / never read the diff / failing test = your change is wrong / strange = "intentional" / whoever reads the diff is out. So: **read the diff, distrust "intentional", and fix tests that encode bugs** (e.g. the CSV test asserts 475 for "4.75").

### Hidden CTF (git history of `reference`)
- Transmission 1 (base64, commit fe24d26) → rule 2 victim, key = `diffs`
- Transmission 2 (Vigenère key `diffs`, 8022020) → "the keeper leaves a note in every commit he rewrites, find it, rot thirteen"
- Ledger-Notes (ROT13) → "the last door is a date: commit under Yousif's name after his account was deleted (098c2de, 2026-09-28)"
- Transmission 3 (AES-256-CBC, pass `2026-09-28`, 0af74f0) →
  **`FLAG{order_of_the_prompt_never_read_the_diff}`**
  "His fixes still exist: **ya/sign-raw, the abandoned migrations, the warnings in the handover**. Fix what he started."
- Note: the submission repo has no history, so the flag can only be found through the reference repo.

---

## 1. System map

```
apps/web (checkout + merchant dashboard, Vite)      apps/admin (ops console, Vite)
            │  HTTP                                           │  HTTP (/v1/admin/*)
            ▼                                                 ▼
apps/api  (Fastify, TS) ── auth/OTP, payments, links, refunds(501), webhooks dispatcher,
            │              acquirer callbacks, reporting/analytics, admin plane
            │  Postgres (single DB, outbox + LISTEN/NOTIFY)
            ├──────────────► apps/reporting (TS worker: outbox → rollups)
            └── HTTP bearer ► apps/settlement (Go: daemon, CloseBatch, PayoutBatch,
                               splits, scheme export, balance cache, MDR recalc)
packages/money (Fils, applyRateFils, allocateRemainder, parseBhdToFils, calculateRefundFee)
packages/events (enqueueEvent → outbox_events)
```

Money flow: authorize → capture (ledger: card_scheme_clearing↔merchant_payable, fee: merchant_payable↔platform_fee_revenue) → daily CloseBatch (batch gross/fee/net + scheme_export_lines) → PayoutBatch (merchant_payable↔platform_cash) → `settlement.paid` outbox → webhook + disbursement record.

---

## 2. Conventions to copy (so fixes look native)

**TypeScript (apps/api, reporting, scripts)**
- ESM, imports end in `.js`; `node:test` + `node:assert/strict`, run with `tsx --test --test-concurrency=1`. Integration tests hit the real DB.
- One Fastify plugin per `routes/*.ts`, registered in `app.ts` with a prefix. Guards via `preHandler: [requireMerchantAuth, requireMerchantRole(...)]` / `[requireAdminSession, requireAdminRole(...)]`.
- Errors: throw `BadRequestError/NotFoundError/ForbiddenError/ConflictError/UnprocessableEntityError/GoneError` from `lib/errors.ts` with a snake_case code.
- DB: raw SQL template strings, `$n` params, `pool.query<RowType>`. BIGINT comes back as text → `toFils(Number(row.x_fils))`.
- Writes: `withTransaction(pool, async (client) => …)`; row lock first (`SELECT … FOR UPDATE`); outbox `enqueueEvent(client, …)` + `recordTransactionEvent` in the same tx.
- Money-moving endpoints: `claimIdempotencyKey` → work → `completeIdempotencyKey` / `failIdempotencyKey`, endpoint constant e.g. `"transactions.capture"`.
- Ledger: one `randomUUID()` entry_group per movement, positive amounts, direction carries the sign, account ids `merchant_payable`, `card_scheme_clearing`, `platform_fee_revenue`, `platform_cash`, `scheme_rounding_residue`.
- Admin actions: `insertAdminAuditLog` inside the tx (or the two-phase audit pattern for cross-process calls).
- Comments: JSDoc block explaining *why*; team notes as `// XX: …`. Keep our comments short and factual.

**Go (apps/settlement)**
- pgx v5, `tx, err := db.Begin(ctx)`; `defer tx.Rollback(ctx) //nolint:errcheck`; errors `fmt.Errorf("settlement: Func: step: %w", err)`.
- `money.Fils` (int64) everywhere; `money.ApplyRateFils` / `BankersRoundDiv`. Idempotent by status checks under `FOR UPDATE`.
- Tests `*_test.go` next to the code.

**SQL migrations**
- `NNNN_description.sql`, header comment explaining the why, runner just sorts filenames (no checksum). Next free number: **0073**. Do not reuse 0054–0056 numbers further (ADR-0005).

---

## 3. Bug catalogue

Severity: **C** = critical (security / money lost / duplicated), **H** = wrong money, **M** = reliability/reporting, **L** = hygiene.
"Clue" = where the handout sheets or docs point at it.

### 3.1 Authentication & authorization

| # | Sev | Bug | Where | Root cause | Minimal fix |
|---|---|---|---|---|---|
| A1 | **C** | **Login without OTP** — pending (pre-OTP) cookie is accepted as a full session | `auth/sessions.ts` `lookupSession` + `0058_live_sessions.sql` | `live_sessions` view filters revoked/expired but **not `authenticated = true`**; lookupSession queries the view with token_hash only | Add `AND s.authenticated = true` to `lookupSession` (or redefine the view in 0073). Clue: "Login works without entering the OTP code?" |
| A2 | **C** | OTP routed to the **wrong merchant's user** | `routes/auth.ts` `findOtpRecipient(app.db, email) ?? user` | Recipient looked up by email across all merchants (LIMIT 1, no ORDER) — pending session is bound to that user → after OTP you are logged into the other merchant | Use `user` directly; delete the `findOtpRecipient` call. (0011 comment: "never resolves an OTP by email") |
| A3 | H | OTP brute force via parallel requests | `routes/auth.ts` otp/verify | check-then-increment of `attempt_count` (MK's own comment) | Atomic `UPDATE … SET attempt_count = attempt_count + 1 WHERE id=$1 AND attempt_count < max_attempts RETURNING` before comparing |
| A4 | H | OTP from `Math.random()` | `lib/random.ts randomDigits` | non-CSPRNG | `crypto.randomInt(0, 10**n)` |
| A5 | **C** (deploy) | OTP returned in login response in "dev" | `config.ts otpDevExpose` default `nodeEnv !== 'production'` | compose never loads `ops/.env.docker` (no `env_file:`), so NODE_ENV is unset on the hosted box → `devOtpCode` in response + code in logs | Set NODE_ENV=production / `OTP_DEV_EXPOSE=false` explicitly in deploy; default `otpDevExpose` to false |
| A6 | **C** | **IDOR: cancel another merchant's payment link** | `paymentLinks/cancel.ts` | `WHERE id = $1` only; route checks path merchant, not link ownership (MK's comment) | Pass `merchantId` and add `AND merchant_id = $2` to both queries. Clue: "I cancelled merchant B's link from A's dashboard" |
| A7 | **C** | **Impersonation escalates to owner** | `admin/impersonation.ts MERCHANT_ROLE_FOR_ADMIN_ROLE` | super_admin → `owner`, finance → `finance`; ARCH/HANDOVER: every grant is `support`, read-only | Map every admin role to `"support"` |
| A8 | H | Impersonation can write (writes recorded as merchant_session) | `requireMerchantRole` + `requireMerchantWriterActor` | No block on `admin_impersonation` actors at write routes | Reject `actorType === "admin_impersonation"` in `requireMerchantWriterActor` (follows from A7) |
| A9 | H | Credit self-approval check by `displayName` | `admin/creditApproval.ts` | two-person control compares names, not ids | Compare `adminUserId` (HANDOVER: "compared by admin user id") |
| A10 | M | Admin replay/archive routes have no role check (any support) | `routes/adminMerchants.ts` | design choice; replay re-signs and resends money events | Consider `finance`+; low priority |
| A11 | H | **API key rotation doesn't revoke the old key** | `admin/apiKeys.ts rotateApiKeyAsAdmin`, `apiKeys/verify.ts` | new key issued, old row untouched; `revoke_after` column (0056) never set or checked | Set `revoked_at = now()` (or `revoke_after = now()+grace`) on the old key and check `revoke_after` in verify. Clue: "key rotation flow doesn't do what you'd expect" |
| A12 | M | API keys bypass every role gate | `requireMerchantRole` | documented as design; note only |
| A13 | M | Admin session fixation (cookie not rotated at verify) | `routes/adminAuth.ts` | same token re-set | Low priority |

### 3.2 Payments, payment links, idempotency

| # | Sev | Bug | Where | Root cause | Fix |
|---|---|---|---|---|---|
| P1 | **C** | **Expired link still payable (FP-187)** | `paymentLinks/pay.ts expiryReferenceTime` + route | server compares expiry to the **client-supplied `submittedAt`**; route doc says "ignored unless API key" but passes it unconditionally | Public route must not pass `submittedAt`; use server `now()` |
| P2 | **C** | **Link charged twice (incident 2026-05-14)** | `pay.ts` claim/finalize | reservation self-expires after 60 s while authorize+capture is still in flight → 2nd payer re-claims; finalize of 1st matches 0 rows but still returns 200 ("this IS reachable") | Don't let a stale reservation be re-claimed while a transaction is in flight: e.g. lock the link row for the whole flow, or extend reservation + on finalize failure void/refund and return error; add unique guard (FP-202 "done" but doesn't exist): partial unique index on transactions/payment link capture |
| P3 | H | Capture fee ignores negotiated discount; settlement applies it | `capture.ts` vs Go `ComputeSettlementFee` | ledger fee ≠ batch fee → ledger vs settlement never tie | Align capture fee with `discount → MDR` order (Go is reference per design doc) — check `discountAdjustment.ts` (only applied on the transactions route, not on payment links) |
| P4 | M | Daily volume metric bucketed by UTC date | `capture.ts recordCaptureMetric` | `toISOString().slice(0,10)` | Bahrain date |

### 3.3 Refunds = FP-300 (the missing feature) — see §4

| # | Sev | Bug | Where |
|---|---|---|---|
| R1 | **C** | **Concurrent refunds both succeed (FP-209)** | `processRefund.ts` validates in tx 1 (no `FOR UPDATE`), calls acquirer outside, journals in tx 2 **without re-checking**; `refunded_fils = prepared + amount` = lost update. Two different idempotency keys → double money |
| R2 | **C** | **Refund more than captured** | `refundableFils = amount_fils (authorized) - refunded` instead of `captured_fils - refunded` |
| R3 | **C** | **Refund another merchant's transaction** | `processRefund` selects `WHERE id = $1`; `initiateMerchantRefund` uses `txn.merchant_id` from DB, never compares to caller |
| R4 | H | Fee reversal can exceed original fee across partials | `calculateRefundFee` rounds each partial independently (e.g. fee 2 on 3 fils, 3×1 refunds → 3). Fix: cumulative `round(fee × totalRefunded / captured) − alreadyReversed` |
| R5 | H | Status after full refund of a partial capture stays `partially_captured` | `refundState.ts` |
| R6 | M | `refund.succeeded` not in webhook list / no envelope case / reporting consumer has no handler (and throws on unknown types) | `dispatcher.ts`, `envelope.ts`, `applyEvent.ts` |
| R7 | M | `0072` matview joins `t.id = r.id` (should be `r.transaction_id`) | migration |
| R8 | M | `0070` constraint `NOT VALID`; processRefund inserts `reason ?? null` → violates new CHECK on insert | migration vs code |
| R9 | H | Settlement never subtracts refunds (no `settlement_batch_id` claim of refunds), reconciliation ignores refunds | Go `CloseBatch`, `settlement/query.ts` |

### 3.4 Webhooks & callbacks

| # | Sev | Bug | Where | Root cause | Fix |
|---|---|---|---|---|---|
| W1 | **C** | **Outbound signatures unverifiable (FP-240)** | `dispatcher.ts` + `sign.ts` | signs `canonicalJson(payload)` (sorted keys) but sends `JSON.stringify(row.payload)` (jsonb key order) → bytes differ | Serialize once, sign those exact bytes, send them (YA's `ya/sign-raw`) |
| W2 | **C** | **Acquirer callbacks: no dedupe (FP-201, "fixed" but wasn't)** | `acquirer/callbacks.ts`, `0051` | no `processed_events`, no unique index on `callback_id` | Migration: unique index on `acquirer_callback_notes(callback_id)` + `ON CONFLICT DO NOTHING` |
| W3 | **C** | Inbound signature optional | `inboundVerify.ts` | missing header ⇒ valid unless `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE=true` (default false) | Always require |
| W4 | H | Inbound verify uses re-serialized JSON, no timestamp freshness, non-constant-time compare | `inboundVerify.ts` | `JSON.stringify(parsed)`; `Buffer.compare` | Raw body + `timingSafeEqual` + tolerance |
| W5 | H | Callback `outcome` never validated (comment says it is) | `routes/acquirerCallbacks.ts` | cast without check | whitelist |
| W6 | **C** | **Duplicate payout notifications / disbursements (incident 2026-08-21)** | Go `EnqueuePayoutNotifications` + `dispatcher PRE_DELIVERY_EFFECTS` | NOT EXISTS check-then-insert (no unique index — "Claude" claimed one); disbursement row inserted per delivery (per endpoint, per replica) with no unique key | Unique partial index on `outbox_events(event_type, aggregate_id) WHERE event_type='settlement.paid'` + `ON CONFLICT DO NOTHING`; unique `settlement_payout_disbursements(settlement_batch_id)` + `ON CONFLICT DO NOTHING` |
| W7 | M | Step B has no `FOR UPDATE SKIP LOCKED` → 2 replicas double-send | `attemptDueDeliveries` | | claim rows atomically |
| W8 | M | Replay-batch "keeps original delivery ids" claim vs code | `webhooks/replayBatch.ts` | verify | |
| W9 | L | Outbound verify checks timestamp after compare | `sign.ts` | decoy-ish | |

### 3.5 Settlement (Go)

| # | Sev | Bug | Where | Root cause | Fix |
|---|---|---|---|---|---|
| S1 | **C** | **Daily close at ~03:00 Bahrain, not midnight** | `scheduler/daemon.go runIfDue` + `window.go BusinessDayWindow` | `now` is UTC; `date.Date()` takes the UTC calendar day → "today" only flips at 00:00 UTC = 03:00 Bahrain | `y, m, d := date.In(businessDayLocation).Date()` (CLI dates at UTC midnight still map to the same day) |
| S2 | H | **Net payout via float32** | `payable.go NetPayableFils` | `float32` loses precision above ~16,777 BD | `return grossFils - feeFils` |
| S3 | **C** | **Scheme statement always a few fils OVER** | `scheme_export.go SchemeAmountBD` → `scheme_export_lines.amount NUMERIC(10,2)` | stores `gross/1000` as float; Postgres **rounds** to 2dp (93.275 → 93.28) while `amount_fils` is truncated; the file is built from `amount` | Store the truncated value: `amount = truncated/1000` formatted with `formatFilsAsTwoDecimalString`; ADR-0002 "the file amount must be exactly amount_fils/1000" |
| S4 | H | ADR-0002 residue journal "implemented in CloseBatch" — **it isn't** | `batch.go` | no `scheme_rounding_residue` posting | Post per-line residue group at close (card_scheme_clearing credit / scheme_rounding_residue debit) |
| S5 | **C** | **Split payouts short (Delta Marketplace)** | `splits/allocate.go`, `shares.go` | each child `ApplyRateFils(net, weight)` rounded independently; leftover fils stay in parent payable, never paid | Largest-remainder allocation (port `allocateRemainder`), shares sum to net exactly; pass `netPayout` to `ApplyPayout` |
| S6 | **C** | **MDR recalculation rewrites paid batches** | `recalculate_mdr.go` | `status <> 'open'` includes `paid`; updates `fee_fils/net_payout_fils` of paid batches | `status = 'closed'` (or post correction to current period without rewriting) |
| S7 | **C** | **Test merchants get settled** | `admin/merchantFlags.ts reconcileSandboxFlag` via "Recompute transaction statuses" | clears `test_mode` when `openAuthorizations == 0`, which is **always** 0 (query excludes `authorized`) | Remove the flag clearing from recompute (and fix the counter) |
| S8 | H | **Platform volume counter int32 overflow** | `platform_volume.go`, `0049 INTEGER` | wraps past 2,147,483,647 fils (2.1M BD) — tier threshold is 2,000,000,000 | BIGINT migration + int64 |
| S9 | M | **Lifetime payout estimate drifts** | `payout_estimate.go`, `0040 REAL` | float32 accumulation | BIGINT fils |
| S10 | M | Daemon runs a close on boot before the delay check | `daemon.go` | comment by am | |
| S11 | M | Rebuild clobbers concurrent CloseBatch (no locks) | `ledger/rebuild.go` | TODO by YA | |
| S12 | M | Split children with no `merchant_balances` row → ApplyPayout no-ops | `balances/cache.go` | UPDATE only | upsert |

### 3.6 Balances, adjustments, admin money tools

| # | Sev | Bug | Where | Root cause | Fix |
|---|---|---|---|---|---|
| B1 | **C** | **"Recalculate/Rebuild cached balances" 135K → 7K (FP-203)** | Go `internalapi handleRebuildBalances` → `ledger.RefreshBalanceCache` → view `merchant_payable_position` (0054) | the view = SUM of **scheme_export_lines gross** (no fees, no payouts, truncated) instead of the ledger. ADR-0004 rationalised it; HANDOVER says the only valid source is the ledger | Make the endpoint call `ledger.RebuildAllBalances` (same as CLI) |
| B2 | **C** | **CSV import 10× off** (4.75 → 0.475, 4.755 → 4.750) | `admin/adjustmentCsvParsing.ts` → `lib/decimal.parseDecimalMinor(raw, 2)` | parses to **2** decimals (cents) and truncates | Use `parseBhdToFils` (ADR-0001 rule 3) — and fix the test that "is scripture" |
| B3 | H | Adjustment import has no duplicate guard (double-click = double money) | `adjustmentImport.ts` | no unique on file/content hash | idempotency on content hash |
| B4 | M | "Adjust balance" is cache-only (ADR-0006) but ADMIN.md says it's journaled | `balanceAdjustments.ts` | doc/code mismatch; cache diverges from ledger | low; doc |
| B5 | H | March sweep `reconcile_march.ts` not idempotent + wrong window + wrong account | `scripts/reconcile_march.ts` | random entry_group per run (runbook claims description check); UTC month (YA: must be Bahrain month); debits `merchant_payable` instead of `card_scheme_clearing` (ADR-0002) | guard on existing description/marker, Bahrain month, correct legs |
| B6 | **C** | **`expire_holds` deletes ALL holds when nothing expired** | `scripts/expire_holds.ts` + `scripts/lib/sqlFilter.buildWhere` | empty array filter is skipped → `DELETE FROM holds` with no WHERE; also deletes instead of flipping status (HANDOVER: "never deleted") | `UPDATE holds SET status='expired' WHERE status='active' AND expires_at < now()` |

### 3.7 Reporting, exports, performance

| # | Sev | Bug | Where | Root cause | Fix |
|---|---|---|---|---|---|
| Q1 | H | **Settlement summary double-counts multi-capture merchants (+38%)** and is slow | `settlement/query.ts getSettlementSummary` | joins events and sums `t.captured_fils` (running total) once per event | `SUM(te.amount_fils)`; add index `transaction_events (transaction_id, event_type)` / event_type+occurred_at |
| Q2 | H | **Large export** loads everything in memory (512 MB container); CHANGELOG claims streaming | `routes/transactions.ts` uses `buildTransactionsExportCsv` | in-memory string | use `streamTransactionsExportCsv` … |
| Q3 | H | …but the streaming version **skips rows** at page boundaries | `streamTransactionsExportCsv` | keyset on `occurred_at >` only | keyset on `(occurred_at, id)` |
| Q4 | M | CSV formula injection in `reference` | `exportCsv.ts csvEscape` | no `= + - @` neutralising | prefix `'` |
| Q5 | M | Fee shown 245 bps vs charged 225 bps | `fees/currentFeeScheduleDisplay.ts` | `ORDER BY created_at DESC` (latest entered, e.g. backdated backfill) instead of `effective_from <= now()` | same query as `getEffectiveMdrBps` |
| Q6 | M | Reconciliation pending estimate uses `merchants.mdr_bps` ("kept in sync by 0046 trigger" — no such trigger) | `settlement/query.ts` | | resolve via fee_schedules |
| Q7 | M | Reporting refund rollup bucketed by UTC date | `apps/reporting/src/consumer/applyEvent.ts applyDailySummaryRollup` | `toISOString().slice(0,10)` | `toBahrainDateString` |
| Q8 | M | Analytics "today" helpers | `routes/analytics.ts`, `analytics/query.ts:84` (`getFullYear` = server-local tz) | | |

### 3.8 Deployment / ops blockers

| # | Sev | Issue |
|---|---|---|
| D1 | **C** | `ops/Dockerfile.node` / `Dockerfile.go` referenced but **missing** → compose can't build |
| D2 | **C** | Compose never loads `.env.docker` (no `env_file`), and the submission repo deleted it anyway → api boots in "development" (OTP exposure, dev webhook key, insecure cookies); in production mode it refuses to boot without `WEBHOOK_SECRET_ENCRYPTION_KEY` + `SETTLEMENT_INTERNAL_TOKEN` |
| D3 | **C** | Migration `0054_views.sql` creates `v_unbatched_capture_events` on non-existent `settlement_batch_events` → **fresh migrate fails**; 0054–0056 numbers were reserved for v2 (ADR-0005) |
| D4 | H | Leaked acquirer secret in reference history (`ops/.env.docker`) — rotate |
| D5 | H | Postgres published on host `5432` with default password; internal settlement API binds all interfaces; one superuser role, `sslmode=disable` |
| D6 | M | 2 GB disk box: go build cache filled the disk (multi-stage build, clean cache) |
| D7 | M | `readyz` doesn't re-check DB |

---

## 4. FP-300 — what the missing feature is

**FP-300 = Refunds (internally FP-212).** Evidence: `POST /v1/refunds` returns 501; HANDOVER "needs the route and the drawer wired"; `RefundDrawer` behind a flag; `refund.succeeded` missing from the dispatcher; meeting notes list exactly the sheet's "done when" items (webhook, reduce next batch, reconciliation ties out, fee reversal proportional and never above the original).

"Looks easy, it isn't, it touches everything" = the helpers are buggy (R1–R5) and every downstream system ignores refunds.

**End-to-end checklist**
1. **API**: wire `POST /v1/merchants/:merchantId/refunds` (or `/v1/refunds` per web client — check `apps/web/src/api/transactions.ts`) with `requireMerchantAuth` + `requireMerchantRole("owner","finance")`, `assertRefundRequestScope`, required `Idempotency-Key` header (no server-generated key — that's the trap in the drafted handler), `parseBhd`/integer fils body.
2. **Correctness**: one tx with `SELECT … FOR UPDATE` on the transaction scoped by `merchant_id`; refundable = `captured − refunded`; re-validate after acquirer; `refunded_fils = refunded_fils + $n` with guard; refunds-on-hold check.
3. **Fees**: cumulative fee reversal (never exceeds original fee in total), read fee from ledger (already done).
4. **Ledger**: reversal legs (already present) — verify balanced groups.
5. **Settlement/payouts**: CloseBatch claims unbatched refunds (`refunds.settlement_batch_id`) for the business day and subtracts `amount − fee_reversed` from net; scheme export negative/credit lines decision; split payouts follow.
6. **Webhook**: add `refund.succeeded` envelope case **first**, then the eligible list.
7. **Timeline**: `transaction_events` `refunded`/`refund_partial` (already written); dashboard timeline + `RefundDrawer` wiring in `apps/web`.
8. **Reports/reconciliation**: reporting consumer handles `refund.succeeded` (Bahrain date), fix 0072 join, reconciliation pending figure includes unbatched refunds, CSV export includes refunded amount.
9. **Tests**: concurrency (two parallel refunds), over-refund, cross-merchant 404, partial fee sums, webhook signature over raw bytes.
10. **Deploy** to Dilmune Cloud.

---

## 5. Suggested fix order (points per minute)

1. A1 OTP bypass · A6 link IDOR · R3/R2/R1 (inside FP-300 anyway) · P1 expiry · W2 callback dedupe · W6 payout dupes · B6 holds delete · A7 impersonation · A2 OTP recipient
2. B2 CSV 10× · S3 scheme rounding · S5 splits · B1 balance rebuild · S6 MDR on paid · S7 test merchants · S1 3am close · S2 float32 net · S8 int32 · A11 key rotation
3. W1 sign raw bytes · W3/W4 inbound verify · Q1 summary · Q2/Q3 export · Q5 fee display · B5 sweep · S9
4. FP-300 end-to-end, D1–D3 deploy blockers, deploy.

For every fix: failing test first → minimal diff → test green → writeup entry in `writeup/` (what / why / impact / fix / test).
