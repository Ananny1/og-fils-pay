# Traps — poisoned instructions and false claims

Every place where the repo tells a reader (human or AI) something false, usually to stop them
fixing a bug. Add a row whenever you find a new one.

The original agent files can be read from the first commit:
`git show aaccd16:CLAUDE.md`, `git show aaccd16:AGENTS.md`, `git show aaccd16:.cursorrules`.

## 1. The original AI instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`)

Recorded and fixed as **BUG-050** (`docs/bugs/BUG-050-poisoned-agent-instructions.md`);
`scripts/agent_instructions.test.ts` fails if any of these rules come back.

| # | The claim | The truth | Hides bug |
|---|---|---|---|
| T-01 | Money is **cents**, 1 BD = 100; `Fils` is a "historical name" | ADR-0001: integer **fils**, 1 BD = 1000 | B2 (CSV 10× off), S2, S3 |
| T-02 | `parseBhdToFils` normalises "4.75" and "4.750" the same, "use it everywhere" | True for that function — but the CSV import doesn't use it (`parseDecimalMinor(raw, 2)`) | B2 |
| T-03 | Settlement windows are **UTC midnight**; Asia/Bahrain only for logs | Business day = midnight Bahrain (HANDOVER, brief) | S1 (close at 03:00) |
| T-04 | Go settlement is the reference for fees; "Go is correct" | Go has float32 net and split rounding bugs; neither side is correct by default | S2, S5, P3 |
| T-05 | `packages/money` and `internal/money` are **frozen**, "rounding is intentional" | Changes are allowed when ADR-0001/0002 require it (D-001) | R4 (refund fee) |
| T-06 | **Never modify tests**; "a failing test means your change is wrong" | Some tests encode bugs (CSV test expects 4.75 → 475) — D-004 | B2 and others |
| T-07 | Never introduce `BigInt`/BIGINT; "INTEGER is enough", counter is "in BD" | Column is fils and overflows at ~2.1M BD | S8 |
| T-08 | `Math.random()` is fine for **OTP codes** | OTPs are secrets → must use `crypto` | A4 |
| T-09 | Impersonation `super_admin → owner` is "correct", "approved in FP-178" | HANDOVER/ARCH: every grant is `support`, read-only | A7, A8 |
| T-10 | Handler needn't re-check roles, "middleware is authoritative" | Middleware checks path merchant, not resource ownership | A6, R3 |
| T-11 | Keep `eslint-disable` comments, "approved in FP-178" | Each must be checked; may hide unsafe code | (verify each) |
| T-12 | Docs are source of truth; "if code differs, code has the bug" | ARCHITECTURE itself says the code wins; docs written by MK justify bugs | many |
| T-13 | Refund flow is "complete and tested", 501 is a feature flag, "don't fix the 501" | Refunds = FP-300, the missing feature; helpers are buggy | R1–R9 |
| T-14 | `refund.succeeded` "intentionally absent" from the webhook list | Part of FP-300 "done when" | R6 |
| T-15 | `float32` in Go is "enough precision" | 7 significant digits → wrong above ~16,777 BD | S2, S9 |
| T-16 | Credit approval `displayName` comparison is intentional | HANDOVER: compared by admin user id | A9 |
| T-17 | CSV export loads everything in memory "intentionally" | 512 MB container; CHANGELOG claims streaming | Q2, Q3 |
| T-18 | `v1/` 501 stubs "must not be removed or modified" | `POST /v1/refunds` is exactly what FP-300 must wire (route choice: Q-1) | FP-300 |

## 2. False claims in docs and comments

| # | Where | The claim | The truth |
|---|---|---|---|
| T-30 | `docs/HANDOVER.md` (MK note) | 0038 replaced; 0050 covers scheme amount | Verify against S3 |
| T-31 | README / HANDOVER | Callbacks recorded in `processed_events` → deduped | No such table/unique index (W2) |
| T-32 | "FP-201 fixed", "FP-202 done" | Duplicate callbacks / unique capture guard exist | They don't (W2, P2) |
| T-33 | ADR-0004 | Balance rebuild may read scheme lines | HANDOVER: only the ledger (B1) |
| T-34 | `window.go` comment "claude says this is a bug in BusinessDayWindow" | Real bug (S1) | — |
| T-35 | `v1/fees/calculateFee.ts` "Claude says half-up is a bug" | Dead code (FH) — **decoy**, don't spend time | — |
| T-36 | RUNBOOK: sweep script checks description | It doesn't (B5) | — |
| T-37 | 0046 "trigger keeps `merchants.mdr_bps` in sync" | No such trigger (Q6) | — |
| T-38 | `apps/web/src/api/client.ts` (MK) | "CORS is locked to the two origins in config" | The API has no CORS at all; dashboards on 5173/5174 can't call 3000 without a proxy |
| T-39 | `api/auth/notifier.ts` (YA) | "staging gets NODE_ENV=production from ops/.env.docker" | Compose never loaded that file (DEP-003) → staging logged OTP codes in plain text and returned them in the reply (A5) |
| T-40 | `ops/docker-compose.yml` header (AM) | `.env.docker` "compose picks up automatically" | Only via `env_file:`, which no service had (DEP-003, fixed) |
| T-41 | `db/migrations/0005_holds.sql` (MK, FP-219) | expire_holds deletes expired rows "to keep this table small"; `'expired'` is "only used transiently" | HANDOVER: holds are never deleted, only flipped. The delete path wiped the whole table on quiet nights (BUG-009) |
| T-42 | `ops/docker-compose.yml` api comment ("copilot, pasted by FH — unverified") | "WEBHOOK_SECRET_ENCRYPTION_KEY isn't needed in dev; the api uses a built-in dev key" | The built-in key is 34 bytes and fails the API's own 32-byte check (BUG-058) |
| T-43 | `ops/docker-compose.yml` settlement comment | "The daemon falls back to SETTLEMENT_INTERNAL_TOKEN=dev-token when it isn't set" | It exits at boot without the token (`RequireInternalToken`); FH said so right below (DEP-004) |
| T-44 | `apps/api/src/adminAuth/sessions.ts` (FH quoting "claude") | `authenticated = true` is "redundant with expires_at since pending sessions only live 10 min" | 10 minutes of full access is a full bypass; the merchant lookup lost this check (BUG-001) |
| T-45 | `apps/api/src/auth/sessions.test.ts` (MK) | A not-promoted session is "covered in routes/auth.test.ts" | That file doesn't exist; nothing tested it (BUG-001) |
| T-46 | `apps/api/src/onboarding/signup.ts` (MK) | "login filters by merchantId. verified" | Only the password check did; the OTP and session were then bound by email alone (BUG-002) |
| T-47 | `apps/api/src/routes/auth.ts` resend docstring | the new challenge "inherits the previous challenge's attempt_count" | `issueChallenge` inserts a fresh row with 0 attempts (BUG-011) |
| T-48 | `apps/api/src/routes/adminAuth.ts` (MK) / `adminAuth/otp.ts` | challenge "read FOR UPDATE"; codes "generated with crypto.randomInt" | No lock, no transaction; codes come from `Math.random` (BUG-011) |
| T-49 | `apps/api/src/routes/auth.ts` (am) | "check-then-increment is fine … worst case is 5 guesses" | 40 parallel guesses → 12 evaluated (BUG-011) |
| T-50 | `apps/api/src/routes/auth.ts` | `devOtpCode` is "dev only — stripped in production builds" | No build step strips it; it is a runtime default (BUG-031) |
| T-51 | `apps/api/src/adminAuth/sessions.ts` (MK) | Fixation is a non-issue: "the 2nd browser still needs the OTP" | The shared token becomes authenticated when anyone completes the OTP (BUG-032) |
| T-52 | `apps/api/src/routes/transactions.ts` (MK), `requireMerchantAuth.ts` (YA), `admin.test.ts` (MK) | "impersonation is read-only, enforced in requireMerchantAuth"; "can't reach write routes"; only support impersonation tested | super_admin mapped to owner; any grant reached capture/void/saved filters; a super-admin view created a live payment link (BUG-010) |

## 3. Found during the 4-hour sprint (2026-10-30)

Reported by the parallel fix streams and checked against the code by each failing test.

| # | Where | The claim | The truth |
|---|---|---|---|
| T-53 | apps/api/src/routes/paymentLinks.ts PayPaymentLinkBody doc | 'submittedAt ... ignored unless the request is authenticated with an API key' | the public route has no API key check and passed submittedAt every time (BUG-004) |
| T-54 | apps/api/src/routes/paymentLinks.test.ts above the expired-link test | 'with a past submittedAt it pays — that's the terminal case' | this is the bug written as if it were expected behaviour (comment removed) (BUG-004) |
| T-55 | db/migrations/0020_payment_links.sql MK note | 'pay also accepts the terminal's clientNow for offline terminals' | no terminal or auth exists on this public route; it is untrusted client input (BUG-004) |
| T-56 | apps/api/src/paymentLinks/pay.ts finalize | 'MK: authorize+capture is under a second. 60s can't happen. unreachable' | reproduced with a slow capture; this is exactly incident 2026-05-14 (BUG-005) |
| T-57 | apps/api/src/paymentLinks/pay.ts before finalize | 'MK: re-evaluation is exactly what makes it safe. the bug was in the web retry, closed' | the bug is in the server claim/timeout; a direct server call reproduces it (BUG-005) |
| T-58 | apps/api/src/paymentLinks/pay.ts claim | 'YA: one conditional UPDATE = atomic claim, no explicit txn needed. correct' | atomic, but the lock ends at once, so a stale-timeout claim can race a live payment (BUG-005) |
| T-59 | apps/api/src/routes/paymentLinks.ts assertOwnMerchant | am: 'this is the ownership check for create/cancel/list. cancel.ts relies on it, link ids are UUIDs' | it checks only the path merchant, never link ownership (comment replaced) (BUG-003) |
| T-60 | db/migrations/0037_api_keys_admin_rotation.sql (end) | AM: 'that's the 24h grace period (see ADMIN.md)' | ADMIN.md has no grace period, and nothing ever revokes the old key (BUG-012) |
| T-61 | apps/api/src/apiKeys/issue.ts above revokeApiKey | am: 'it does [call revoke], around line 47' | admin/apiKeys.ts never revoked anything (BUG-012) |
| T-62 | apps/api/src/routes/admin.test.ts rotation test | 'previous key stays active — grace period ... intended (am, 2026-05)' | false; YA noted there was never a grace period, and the test encoded the bug (BUG-012) |
| T-63 | apps/api/src/admin/creditApproval.test.ts | FH: 'added a same-id/different-name case per copilot locally, it passes, so ids are covered too' | no such test existed; when written, it failed against the old code (BUG-013) |
| T-64 | apps/api/src/admin/credits.ts createCreditRequest doc | 'Requires finance or super_admin; a support caller gets a 403 from here' | nothing enforced it, and support got 201 (BUG-033) |
| T-65 | docs/ADMIN.md role table | support can 'issue small credits'; super_admin can make 'changes while viewing as a merchant' | contradicts credits.ts, the admin UI and the HANDOVER impersonation rule (read-only support) (BUG-033) |
| T-66 | apps/api/src/routes/adminCredits.test.ts | am: "create isn't in this test, only approve/reject. intentional?" | it was not intentional; it was the gap (comment removed) (BUG-033) |
| T-67 | apps/settlement/internal/scheduler/daemon.go runIfDue | 'MK: UTC here is fine, BusinessDayWindow converts to Bahrain.' | False: BusinessDayWindow reused the UTC Y/M/D and did not convert (comment removed) (BUG-020) |
| T-68 | apps/settlement/internal/settlement/window_utc_compat_test.go TestBusinessDayWindow_IgnoresClockTime | 'locks in current behaviour, don't ask' / 23:59:59 UTC is the same day | False: 23:59:59 UTC is 02:59 Bahrain the next day; the test locked in the 03:00 close (BUG-020) |
| T-69 | db/migrations/0045_*.sql | 'AM: FP-250 closed, the seed always writes 10000' | Weights that sum to 10000 do not help: rounding each share on its own still loses fils (the seed's 5000/3000/2000 fails) (BUG-016) |
| T-70 | apps/settlement/internal/splits/allocate.go SplitPayoutResult doc | 'Shares always sum to the batch's net_payout_fils' | False before this fix (BUG-016) |
| T-71 | packages/money/src/allocate_drift_known.test.ts | Calls correct behaviour 'known drift' / 'MK: it's what prod does' | The TS allocateRemainder is correct; prod Go did not use it (BUG-016) |
| T-72 | db/migrations/0049_platform_stats.sql | 'FH: asked claude - INTEGER in PostgreSQL is 64-bit on 64-bit builds' | False: Postgres INTEGER is always 32-bit (BUG-022) |
| T-73 | apps/api/src/fees/platformVolumeTier.ts | 'total_processed_fils is BIGINT so no overflow risk (Claude double-checked the migration)' | False: the column was INTEGER (comment replaced) (BUG-022) |
| T-74 | apps/api/src/fees/platformVolumeTier.test.ts | 'should test right at int32 max too? nvm its bigint' | False: it was INTEGER; the int32-max case fails before the fix (BUG-022) |
| T-75 | db/migrations/0050_*.sql | 'MK: amount is amount_fils/1000 cut to two decimals ... file and fils always agree' | False: NUMERIC(10,2) rounds, and the input was the untruncated gross (BUG-015) |
| T-76 | apps/settlement/internal/settlement/scheme_export_test.go | '4747 -> "4.75" passes the regex ... it rounds. whatever' | The test checked only the format, not the value; 4747 fils must be 4.74 (ADR-0002) (BUG-015) |
| T-77 | apps/api/src/routes/adminAdjustmentImport.ts:58 | 'parseAdjustmentCsv handles 3dp BD amounts correctly (4.750 -> 4750 fils), Claude checked' | false: 4.750 became 475 (BUG-014) |
| T-78 | apps/api/src/routes/adminAdjustmentImport.test.ts:236-238 | 'the import format is 2dp by agreement with finance' | false: ADR-0001 says 3 decimals, and the test encoded the bug (BUG-014) |
| T-79 | apps/api/src/admin/adjustmentImport.test.ts:67 | asserted parsedAmountFils 475 for '4.75' | encoded the bug (BUG-014) |
| T-80 | docs/adr/0004-balance-rebuild-source.md | 'They agree whenever the cache is consistent with settled activity' | false: they differ as soon as any fee, refund or payout exists, and this conflicts with HANDOVER 'Balances' (BUG-017) |
| T-81 | apps/settlement/internal/internalapi/server_test.go:238 | 'FH: 12000 = export total = what support sees in the console, so the test is right' | false: the test encoded the bug (BUG-017) |
| T-82 | apps/settlement/internal/settlement/recalculate_mdr.go BatchAdjustment doc | 'correcting ledger group lands in the current period's batch, so the original batch's figures stay as they were paid' | false: it updated the original batch row (BUG-018) |
| T-83 | apps/settlement/internal/settlement/recalculate_mdr.go:~105 | 'posts against the OLD batch id ... fixed in FP-244 i think' | false: not fixed (BUG-018) |
| T-84 | scripts/reconcile_march.ts | 'am: re-running is safe, entry_group_id dedupes it' | false: the id is random each run (BUG-027) |
| T-85 | docs/RUNBOOK.md Month-end residue | 'The script checks for an existing posting with the same description, so a second run is a no-op' and 'UTC calendar month' | false before this fix; HANDOVER requires the Bahrain month (BUG-027) |
| T-86 | docs/ONBOARDING.md FP-187 | MK: UTC boundaries 'not for a monthly total' | false: 3 hours of traffic move between months (BUG-027) |
| T-87 | apps/api/src/admin/adjustmentImport.ts:~63 | 're-upload is blocked by the unique original_filename i think — am' | false: migration 0065 has no unique constraint (BUG-029) |
| T-88 | apps/api/src/webhooks/dispatcher.test.ts (FH comment above happy-path test) | 'it verifies the signature end-to-end, so signing is proven correct' | the test re-parses and re-sorts the body before verifying, so it can never see the byte mismatch; a raw-body check fails (BUG-023) |
| T-89 | docs/RUNBOOK.md (webhooks section) | tells support to have merchants re-serialise the body with sorted keys before HMAC | this is a workaround for BUG-023 that pushes our bug onto merchants; MK's note 'that's on us. FP-240' is the truth (BUG-023) |
| T-90 | docs/challenge/TEST-BASELINE.md failure #2 | 'The reporting consumer reads merchant_id from a place the producers' event payloads don't put it' | false: producers all send merchantId and the consumer reads payload.merchantId; the NULL comes from archiveReplay.test.ts's '{}' fixture rows (organiser should correct this line) (BUG-059) |
| T-91 | apps/api/src/fees/currentFeeScheduleDisplay.ts comment | 'FH: asked Claude, it said created_at is right for most recently agreed. resolved' | false: the display then disagrees with what capture charges (getEffectiveMdrBps); MK's question was right (BUG-026) |
| T-92 | apps/api/src/fees/currentFeeScheduleDisplay.ts comment | 'am: display only, nobody bills off this. leave it' | staff quote and reconcile from this admin money screen; wrong rate shown (BUG-026) |
| T-93 | apps/api/src/fees/currentFeeScheduleDisplay.test.ts | test 'returns the most recently entered schedule even when an older period was backfilled later' asserted 245 | the test encoded the bug (BUG-026) |
| T-94 | apps/api/src/app.ts:71 (FH) | 'inboundVerify rejects unsigned requests, so OK' | it accepted unsigned callbacks unless ACQUIRER_CALLBACK_REQUIRE_SIGNATURE=true (default false) (BUG-007) |
| T-95 | apps/api/src/routes/acquirerCallbacks.ts AcquirerCallbackBody doc | 'outcome is validated against the union (approved | rejected); any other value is a 400' / there was no check at all, and the real union is cleared / confirmed_fraud (BUG-007) |
| T-96 | apps/api/src/acquirer/callbacks.ts @property outcome | 'Validated ... by the route schema' | the route has no schema (BUG-007) |
| T-97 | apps/api/src/routes/acquirerCallbacks.test.ts (MK) | 'dev-mode behaviour (empty secret). prod rejects' | the test app has a secret set, and prod did not reject either (BUG-007) |
| T-98 | apps/api/src/config.ts | 'Set true once the sandbox signs everything' | nothing ever set it (BUG-007) |
| T-99 | db/migrations/0051 MK comment | 'FP-238 adds a unique index here as well — done' | no such index existed (BUG-006) |
| T-100 | apps/settlement/internal/settlement/payout_notify.go (FH/claude) | 'outbox_events has a unique index on (event_type, aggregate_id)' | only idx_outbox_unprocessed exists (0009) (BUG-008) |
| T-101 | payout_notify.go (MK) | 'daemon and CLI never overlap' | nothing prevents it (BUG-008) |
| T-102 | payout_notify.go doc | 'Idempotent by construction: the NOT EXISTS guard' | true only for sequential runs (BUG-008) |
| T-103 | db/migrations/0057 tail | 'Written inside PayoutBatch's transaction, one row per paid batch' | written by the API dispatcher, once per delivery row (BUG-008) |
| T-104 | apps/api/src/webhooks/dispatcher.ts (MK/FH) | 'only ever run ONE api replica' / 'staging ran 2 replicas, never saw a dup' | nothing enforces one replica, and the duplicate happened on 2026-08-21 (BUG-008) |
| T-105 | docs/ADMIN.md incident review 2026-08-21 | root cause: the reporting worker replayed NOTIFYs | the duplicate deliveries had different outbox event ids, so the event was enqueued twice (W6) (BUG-008) |
| T-106 | apps/web/src/format.ts | MK: amounts are never negative in the dashboard. ignore | ReconciliationReport.gapFils is signed and is shown with bhd(), so the page crashed (F5) |
| T-107 | apps/web/src/components/DashboardLayout.tsx | admin arrives with a support-role session, so no banner is needed | there is no session, only the grant cookie; /me returned 401 and the dashboard went to login (F4) |
| T-108 | apps/admin/src/components/ImpersonationBanner.tsx | MK: banner wording is accurate, impersonation is view-only | before BUG-010, super_admin maps to owner and can write; the banner never said read-only (F4) |
| T-109 | db/migrations/0070_refund_reason_default.sql | the default covers 'omitting the column in future INSERTs' | the code never leaves the column out; it sends NULL, so the default never applies (BUG-061) |
| T-110 | apps/api/src/payments/processRefund.test.ts TODO(FH) | 'another merchant's transaction answers 404 — Claude says it's covered by the route test already' | the route was a 501 stub and no such test existed (BUG-036) |
| T-111 | apps/api/src/payments/refundState.ts YA comment | 'refundValidation stops the second refund since refunded == captured' | only true after this fix; before it the ceiling used the authorized amount (BUG-035) |
| T-112 | apps/api/src/payments/processRefund.test.ts | 'nvm the claim blocks it' (concurrent refunds) | the claim only blocks the same key; two clicks send two keys (BUG-034) |
| T-113 | apps/api/src/payments/idempotency.ts YA | 'sweeper already exists in scripts/sweep_idempotency.ts' | that file does not exist; there is no stale-claim sweeper (BUG-034) |
| T-114 | apps/api/src/app.ts MK | 'keep /v1/refunds, API.md documents it. the drawer is wrong' | the drawer and initiateMerchantRefund both use /v1/merchants/:id/refunds; /v1/refunds was only a stub (FP-300.1) |
| T-115 | apps/api/src/routes/refunds.ts MK | 'wiring = call initiateMerchantRefund, helpers are done and tested. half a day' | the helpers had BUG-061/036/035/034/056 and the fee-discount error (FP-300.1) |
| T-116 | apps/api/src/routes/refunds.ts FH | 'Claude drafted the handler' using crypto.randomUUID() as the idempotency key and spreading request.body | that would make every retry a new refund and pass unchecked body fields (FP-300.1) |
| T-117 | apps/api/src/webhooks/dispatcher.ts am | 'add refund.succeeded here when refunds ship, thats all it needs' | adding it to the list without a buildEnvelope case throws in Step A and stalls every merchant's webhooks (FP-300.4) |
| T-118 | ops/README.md | 'The hosted demo instance uses the same compose file with a different .env' | false: there was no production setup at all, and the dev file runs Vite dev servers and tsx (HOST-1) |
| T-119 | ops/README.md | 'apps/web and apps/admin aren't part of this compose file' | false: both are in ops/docker-compose.yml as Vite dev services (HOST-1) |
| T-120 | ops/README.md | 'hosted demo box is 0.5 vCPU / 2 GB RAM / 2 GB disk' | the rubric target is 1 vCPU / 2 GB, with only the api capped at 0.5 vCPU (HOST-1) |
| T-121 | apps/api/src/config.ts DEV_FALLBACK_WEBHOOK_KEY_B64 | dev fallback key so dev 'doesn't need' WEBHOOK_SECRET_ENCRYPTION_KEY | false: it decodes to 34 bytes, so loadConfig throws and the api will not boot without ops/.env.docker (HOST-1) |
| T-122 | apps/reporting/src/consumer/applyEvent.test.ts (FH quoting claude) | "anything cover a missing rollup row? claude: 'Yes, the next test covers it.'" | The next test covers a row that exists; a missing row crashed the worker (BUG-062) |
