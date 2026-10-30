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
