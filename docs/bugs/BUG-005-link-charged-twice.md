# BUG-005 — One payment link charged to two (or three) customers

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Money (checkout) |
| **Analysis ID** | P2 (see `docs/challenge/ANALYSIS.md`) |
| **Clue** | Incident 2026-05-14 (`docs/incidents/postmortem-2026-05.md`), `docs/archive/slack-export-fp-ops-2026-05.txt`, FP-202 |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-005` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

A payment link is single-use. During the incident eight links were paid 17 times: two (once three)
different cardholders were charged for one invoice. Every double had a first capture that took more
than 60 seconds at the acquirer (big baskets, 3DS step-up). The second payer opened the link while
the first was still "spinning". Both got a "paid" screen.

Reproduce (test below): reservation timeout 1 s, first payer's capture takes 2.5 s, second payer
starts at 1.3 s → **two captured transactions, both payers get 200**.

## 2. Why it happened — the root cause

The checkout reserves the link, then runs authorize + capture **with no lock held**, then marks the
link paid. A reservation older than `PAYMENT_LINK_RESERVATION_TIMEOUT_SECONDS` (60 s) may be taken
over, so a slow-but-alive payer loses the link without knowing it:

```ts
// apps/api/src/paymentLinks/pay.ts (before) — claim
WHERE token = $1 AND (status = 'active'
      OR (status = 'reserved' AND reserved_at < now() - ($2 || ' seconds')::interval))
```

1. Payer A claims, authorizes, starts a slow capture.
2. After 60 s payer B re-claims the "stale" reservation, authorizes, captures, and marks the link paid.
3. A's capture finishes (money taken). A's finalize `UPDATE ... WHERE status = 'reserved'` matches
   **0 rows** — and the code still answered **200 "paid"**:

```ts
// before
if (!finalized) {
  console.error(`... invariant violation, investigate`);
  return { statusCode: 200, body: { status: "paid", transactionId: txnId, ... } };
}
```

Nothing in the database could stop it either: `transactions` had no link to `payment_links`, so a
second captured transaction for the same link was just another row. Capture never re-checked that
the caller still owned the link, and `releaseReservation` could even release a reservation that now
belonged to the other payer.

False claims that kept it hidden (see `docs/challenge/TRAPS.md` T-32):
- The postmortem's root cause "duplicate acquirer callbacks" is wrong. Slack (AM, 23:17 and
  05-22): "the two notes have different transaction ids … one callback per transaction", and "every
  double … had a first attempt > 60 s". Callbacks never create captures; the checkout does.
- The postmortem says the claim was "ruled out" because Postgres re-evaluates the `UPDATE`. True but
  irrelevant: the re-evaluation happily matches a reservation that has timed out.
- Action item FP-202 "unique constraint, at most one successful capture per link — Done". No such
  constraint or column existed in any migration.
- Code comment "MK: authorize+capture is under a second. 60s can't happen. unreachable". The
  incident data shows 60–70 s captures.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Charged for an invoice someone else already paid | Critical — real money, needs refunds |
| Merchants | Extra captures settled to them, then clawed back; customer complaints | High |
| FilsPay (finance / ops) | Goodwill credits (BD 1,284.500 in May), manual voids, ledger noise | High |
| Acquirer / card scheme | Disputes / chargebacks on the duplicate captures | Medium |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0075_payment_link_single_capture.sql` | `payment_links.reservation_id`; `transactions.payment_link_id`; partial unique index `uq_transactions_payment_link_captured ON transactions(payment_link_id) WHERE captured_fils > 0` — the real FP-202 |
| `apps/api/src/paymentLinks/pay.ts` | claim writes a fresh `reservation_id`; authorize records `paymentLinkId`; capture runs fenced on that reservation; on "reservation lost" the payer's authorization is **voided** and they get a 409 that says what happened (`payment_link_already_paid` / `payment_link_processing` / `payment_link_canceled`); a finalize that cannot match **never returns 200**; release is fenced on `reservation_id`; an exception releases our own reservation |
| `apps/api/src/payments/capture.ts` | optional `paymentLink` input: `SELECT ... FROM payment_links FOR UPDATE`, require `status='reserved' AND reservation_id = mine` **before** calling the acquirer, and set the link `paid` in the **same DB transaction** as the capture |
| `apps/api/src/payments/authorize.ts` | optional `paymentLinkId` stored on the transaction |
| `apps/api/src/payments/void.ts` | accepts a `system` actor (the checkout voiding a loser's hold) |

```ts
// after — capture.ts, before the acquirer call
const linkRow = (await client.query(
  `SELECT status, reservation_id FROM payment_links WHERE id = $1 FOR UPDATE`, [input.paymentLink.id])).rows[0];
if (!linkRow || linkRow.status !== "reserved" || linkRow.reservation_id !== input.paymentLink.reservationId) {
  return { statusCode: 409, body: { error: "payment_link_reservation_lost", ... } };   // no money moved
}
... acquirer.capture(...) ...
UPDATE payment_links SET status = 'paid', transaction_id = $2, ... WHERE id = $1;      // same transaction
```

How the two incident shapes now play out:

| Case | Before | After |
|---|---|---|
| A's **capture** is slow, B arrives after the timeout | B re-claims and pays; A also captured; both 200 | A holds the link row lock during its capture, so B's claim waits, then sees `paid` → B gets 409 `payment_link_already_paid`. One capture. |
| A's **authorize** is slow, B arrives after the timeout | Both capture; both 200 | B re-claims (new `reservation_id`) and pays. A reaches capture, the fence fails before the acquirer is called, A's authorization is voided (hold released), A gets 409. One capture. |
| Anything slips past the app | Silent double | The unique index rejects a second captured transaction for the link. |

Why smallest correct: the claim/finalize design and the 60 s self-heal stay. We only add an owner to
the reservation, check it at the one point where money moves, and make "capture" and "link paid"
one atomic step. The row lock is held by capture anyway (it already locks the transaction row through
the acquirer call), so no new long-held lock pattern is introduced.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Fencing token on the reservation + link lock during capture + capture & mark-paid in one transaction + unique index | Exactly one capture under any timing; loser stopped before money moves; DB guarantee | Migration; second payer waits for an in-flight capture | ✅ |
| 2 | Hold the link row lock for the whole flow (authorize + capture) | Simple to reason about | A DB connection + transaction held across two acquirer calls per payer; pool exhaustion under load | |
| 3 | Just raise the reservation timeout | One-line | Only moves the threshold; a 3DS step-up can always be slower | |
| 4 | Keep the race, void/refund the late capture after the fact | No schema change | Money moves twice, then back; refunds don't exist yet (FP-212) | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-005: slow first capture outlives the reservation -> second payer cannot also be charged` | `apps/api/src/paymentLinks/pay.new.test.ts` | ❌ 2 captured transactions | ✅ 1 capture, statuses `[200, 409]`, link points at the captured txn |
| `BUG-005: slow first authorize outlives the reservation -> late payer is refused and its hold voided` | same | ❌ late payer 200 and captured | ✅ late payer 409, its transaction `voided`, hold `released` |
| `BUG-005: the database itself refuses a second captured transaction for one link` | same | ❌ column/index did not exist | ✅ unique violation |

```bash
DATABASE_URL=... npm run migrate
DATABASE_URL=... npx tsx --test apps/api/src/paymentLinks/pay.new.test.ts
```

The tests use the real simulator wrapped so one chosen call is slow (no simulator change needed).
Existing tests changed: none. The existing "idempotent replay after a reservation-timeout retry" test
still passes (the replayed capture is finalized by the fenced finalize in `pay.ts`).
