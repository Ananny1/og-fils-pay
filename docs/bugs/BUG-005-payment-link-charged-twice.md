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

| File | Change |
|---|---|
| `apps/api/src/paymentLinks/pay.ts` | Claim, release and finalize now run in **one DB transaction on a dedicated client**; the claim's row lock on the link is held through authorize + capture until finalize commits (the same pattern `capture.ts` already uses for the transaction row). A second payer waits on the lock (max 5 s via `lock_timeout`, then `409 payment_link_processing`) and, once the first commits, sees `409 payment_link_already_paid`. Any error rolls the claim back. False comments removed. |
| `apps/api/src/paymentLinks/payConcurrency.test.ts` | New: slow capture past the reservation timeout + second payer → exactly one capture, exactly one "paid" answer. |

```ts
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(`SET LOCAL lock_timeout = '${PAY_LOCK_WAIT_MS}ms'`);
  const result = await payWithLinkLocked(client, pool, acquirer, config, input, expiryCheckTime);
  await client.query("COMMIT");
  return result;
} catch (err) { ROLLBACK; 55P03 → 409 payment_link_processing; else rethrow }
```

Why it removes the root cause: the "is the first payer still alive?" question is now answered by
Postgres itself (the lock lives exactly as long as the first request's connection), not by a timer.
A crash drops the connection, rolls back the claim, and the link is payable again at once, so the
self-heal still works without a sweep job. No migration needed.

**Trade-off (known):** each in-flight checkout holds one extra pool connection for the duration of
the acquirer calls. The pool has `connectionTimeoutMillis`, so overload fails fast instead of
hanging; with the default `PG_POOL_MAX` of 5, more than ~4 checkouts at the very same second could
see a 500 and should retry. Raising the pool size is a config change, not code.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Hold the link row lock for the whole pay flow (transaction on a dedicated client) | Kills the race by construction; same pattern as `capture.ts`; crash-safe; no migration | One extra DB connection per in-flight checkout | ✅ |
| 2 | Claim id + "lost claim" detection: on finalize 0 rows, void/refund the second capture and answer 409 | No held connection | The card is still charged then refunded (customer sees it); more code paths; refund can fail | |
| 3 | Make the reservation timeout much longer than any possible acquirer call | One config line | Only moves the race; a truly abandoned link stays blocked for that long | |
| 4 (creative) | DB guard: partial unique index "one captured transaction per payment link" (the FP-202 index that was marked done but never existed), with a `payment_link_id` column on transactions | Belt-and-braces at schema level | Needs a migration + column in authorize; still needs #1 or #2 to avoid the acquirer-side charge | |

**Why we chose #1:** it is the only option that stops the second acquirer charge from ever
starting, with a small diff in the existing style.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `slow capture past the reservation timeout + a second payer -> exactly one charge` | `apps/api/src/paymentLinks/payConcurrency.test.ts` | ❌ fails (2 captured transactions, both answered 200, "invariant violation" logged) | ✅ passes |
| payment-link route tests incl. crash/timeout replay, `pay.test.ts`, `status.test.ts` (21) | `apps/api/src/...` | ✅ | ✅ |
| Full API suite | `npm test --workspace @filspay/api` | 352/364 | 352/364 (only the known baseline: 11 refund BUG-061 + 1 webhook backoff BUG-060) |

```bash
docker compose -f ops/docker-compose.yml run --rm --no-deps -T -e DATABASE_URL=... api \
  npx tsx --test apps/api/src/paymentLinks/payConcurrency.test.ts
```

`tsc --noEmit -p apps/api` clean. Existing tests changed: none.
