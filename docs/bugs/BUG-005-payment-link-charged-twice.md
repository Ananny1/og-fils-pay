# BUG-005 — Payment link charged twice on a slow payment

| | |
|---|---|
| **Severity** | High (P2, real money taken twice) |
| **Area** | Money (payment links, concurrency) |
| **Analysis ID** | P2-C "Link charged twice (incident 2026-05-14)" in `docs/challenge/ANALYSIS.md` |
| **Clue** | Incident 2026-05-14 "two customers charged on one link"; FH comment "this IS reachable" in `pay.ts` |
| **Decision** | D-016 (4-hour sprint, stream S2) |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** One payment link (one invoice) can take money from two cards when the bank is slow.
- **Why:** The first payer "reserves" the link, but the reservation counts as abandoned after 60 s even though the first payer's bank call is still running. A second payer then takes the link and pays too.
- **What it breaks:** The shop gets paid twice for one invoice, a customer is charged for nothing, and **both** customers are told "paid". The second charge is not recorded on the link at all (only an error log line), so nobody notices until a complaint.

## 1. The issue

Reproduce (test `payConcurrency.test.ts`, reservation timeout 1 s, capture takes 2.5 s):

```
t=0.0s  payer A  claims link, authorizes, capture starts (slow)
t=1.5s  payer B  claim matches: reservation is "stale" (> 1 s) → authorizes, capture starts
t=2.5s  A  finalize → link paid (txn A)                     → 200 paid
t=4.0s  B  finalize matches 0 rows → logs "invariant violation" → 200 paid
result: 2 captured transactions for one link
```

## 2. Why it happened

`apps/api/src/paymentLinks/pay.ts` claimed the link with a single `UPDATE` on the pool (lock
released at once) and allowed re-claim of `status = 'reserved' AND reserved_at < now() - timeout`.
Nothing tied that timeout to the payment actually still running. Authorize + capture ran with no
lock on the link; finalize (`WHERE status = 'reserved'`) failed for the slower payer, and that
branch still returned **200 paid**.

**False claims (traps) in the code comments:**

| Where | Claim | Truth |
|---|---|---|
| `pay.ts` finalize | "MK: authorize+capture is under a second. 60s can't happen. unreachable" | Reproduced with a slow capture; the incident of 2026-05-14 is exactly this |
| `pay.ts` before finalize | "MK: re-evaluation is exactly what makes it safe. the bug was in the web retry, closed" | The bug is in the server claim, not the web retry; a direct server call reproduces it |
| `pay.ts` claim | "YA: one conditional UPDATE = atomic claim, no explicit txn needed. correct" | Atomic, but the lock ends at once, so a stale-timeout re-claim races a live payment |

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Second payer charged for an invoice already paid; told "paid" | High |
| Merchants | Double money for one order; must refund by hand; looks like fraud to the customer | High |
| FilsPay (finance / ops) | Captured money with no link record; disputes, chargebacks, reconciliation gaps | High |
| Acquirer / card scheme | Duplicate charges → chargebacks against FilsPay | Medium |

## 4. The fix

The fix was done in two steps. The first version held a row lock on the link inside an open
transaction on its own connection, while `authorizeTransaction` / `captureTransaction` each took a
**second** connection from the same pool. Code review found two problems with that:

| Problem | What happened |
|---|---|
| Pool starvation (major) | `PG_POOL_MAX` is 5. Five checkouts on five different links each held 1 connection and waited for a 2nd → all five failed after the 5 s connection timeout. Payers waiting on the same link also each parked a connection for up to 5 s, starving the first payer's capture. |
| Lost finalize (minor) | If finalize / `COMMIT` threw after a successful capture, `ROLLBACK` put the link back to `active` with no transaction, so it could be paid again. |

**Current fix — one connection per checkout, no waiting:**

| File | Change |
|---|---|
| `apps/api/src/paymentLinks/pay.ts` | A checkout takes **one** pool connection and a session advisory lock on the link with `pg_try_advisory_lock` (no waiting). Lock busy → `409 payment_link_processing` at once, connection returned. Claim, authorize, capture and finalize run on that same connection, each committed on its own. Finalize runs right after capture; if it fails it is logged loudly (link id + transaction id) and the payer still gets 200 (money moved). The claim re-admits a stale `reserved` link only if no capture for that link completed under a **different** Idempotency-Key, so a lost finalize never makes the link payable again (the same key may retry: it replays and finalizes the one existing transaction). The lock is released in `finally`; if unlocking fails the connection is destroyed so the lock dies with it. |
| `apps/api/src/db/withTransaction.ts` | Accepts a client that is already checked out; it is used as is and not released (the owner releases it). |
| `apps/api/src/payments/authorize.ts`, `capture.ts` | Parameter type widened to `Pool \| PoolClient` so the checkout can pass its own connection. No logic change. |
| `apps/api/src/paymentLinks/payConcurrency.test.ts` | Three new tests (see proof). |

```ts
const client = await pool.connect();                        // the only connection this checkout uses
const lock = await client.query(`SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`, [lockKey]);
if (!lock.rows[0]?.locked) return 409 payment_link_processing;   // fast, nothing parked
return await payWithLinkLocked(client, ...);               // claim → authorize(client) → capture(client) → finalize
// finally: pg_advisory_unlock; client.release(err) destroys the connection if unlock failed
```

Why it removes the root cause: "is the first payer still alive?" is answered by Postgres (the lock
lives exactly as long as the first payer's connection), not by a timer. A crash drops the lock;
the stale `reserved` row heals after the reservation timeout, but never once money was captured.
No migration needed.

**Trade-offs (known):**
- Each checkout still uses one connection for the whole acquirer call, so at most `PG_POOL_MAX`
  checkouts run at the same moment; the next one waits for a free connection (CAP-2: 503 after the
  connection timeout). This is the normal limit of any request, not starvation.
- A crash in the middle of the acquirer **capture** call (acquirer charged, DB rolled back) leaves no
  record; the link heals after the timeout. That gap is in `capture.ts` itself and is not new.
- A link whose finalize failed stays `reserved` until someone marks it paid by hand (from the log line).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | One connection per checkout: session advisory lock with `pg_try_advisory_lock` + authorize/capture on the same client; claim/finalize committed on their own; capture check on re-claim | Never waits for a 2nd connection; losers get 409 at once; crash-safe; lost finalize can't re-open the link; no migration | `withTransaction`/authorize/capture accept a client (type change only) | ✅ |
| 2 | Committed claim only (`active → reserved` up front), drop the timeout re-claim | Smallest diff, no held lock | A crashed payer leaves the link stuck forever (needs a sweep job or ops); keeping the timeout brings back the incident race | |
| 3 | Keep the row-lock transaction but pass the held client into authorize/capture (nested transactions → savepoints) + `NOWAIT` | One connection | authorize/capture would commit together with finalize: a late failure rolls back the record of money already captured (worse version of finding 2) | |
| 4 | Earlier fix: row lock held on a dedicated client, authorize/capture on a second connection | Simple | Pool starvation at 5 checkouts; waiting payers park connections; lost finalize re-opens link | (replaced) |
| 5 | Make the reservation timeout much longer than any possible acquirer call | One config line | Only moves the race; a truly abandoned link stays blocked for that long | |
| 6 (creative) | DB guard: partial unique index "one captured transaction per payment link" with a `payment_link_id` column on transactions | Belt-and-braces at schema level | Needs a migration + column in authorize; still needs #1 to stop the acquirer-side charge | |

**Why we chose #1:** it is the only option that stops the second acquirer charge from ever
starting, never makes one request wait for a second connection, and keeps crash self-heal, with
a small diff in the existing style.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `slow capture past the reservation timeout + a second payer -> exactly one charge` | `apps/api/src/paymentLinks/payConcurrency.test.ts` | ❌ on the original code (2 captures, both 200) | ✅ |
| `pool-size (5) concurrent checkouts on 5 different links all succeed (no pool starvation)` (pool max 5) | same | ❌ on the first fix (`timeout exceeded when trying to connect`) | ✅ 5 × 200 |
| `5 parallel payers on the SAME link -> one charge, the others get 409 fast` (pool max 5) | same | ❌ on the first fix (payers rejected with pool timeout) | ✅ 1 × 200, 4 × 409 in < 1 s, 1 capture |
| `a captured payment whose finalize was lost never makes the link payable again` | same | ❌ on the first fix (second card charged, 200) | ✅ not charged |
| payment-link route tests incl. same-key crash/timeout replay, `pay.test.ts`, `status.test.ts` | `apps/api/src/...` | ✅ | ✅ |
| Full API suite | `npm test --workspace @filspay/api` | 435/435 + 3 new red | 438/438 |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -T -e DATABASE_URL=... api \
  npx tsx --test apps/api/src/paymentLinks/payConcurrency.test.ts
```

`tsc --noEmit -p apps/api` clean. Existing tests changed: none.
