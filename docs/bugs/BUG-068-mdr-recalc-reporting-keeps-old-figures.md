# BUG-068 — After an MDR recalculation the merchant dashboard keeps the old payout figures

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Settlement · Reporting |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

## Summary

- **What's wrong:** "Recalculate MDR" changes a closed batch's fee and net payout, but the merchant's payout figures in reporting never change. The bank payout uses the new net, the dashboard shows the old one.
- **Why:** `RecalculateMDR` updates `settlement_batches` but emits no outbox event; reporting's `merchant_payout_trends` only learns fee/net from `settlement.batch_closed`.
- **What it breaks:** merchants see a payout amount that does not match their bank; replaying the outbox (`reporting rebuild`) gives the same stale numbers.

## Root cause

`apps/settlement/internal/settlement/recalculate_mdr.go`: `UPDATE settlement_batches SET fee_fils = $2, net_payout_fils = $3`
with no `outbox_events` insert. `apps/reporting/src/consumer/applyEvent.ts` `applyBatchClosed` is the
only writer of `merchant_payout_trends.fee_fils / net_payout_fils` (upsert on `(merchant_id, settlement_batch_id)`),
read by `apps/api/src/analytics/query.ts`.

**Present in the original code:** `apps/settlement/internal/settlement/recalculate_mdr.go:109` at 8b58b0f
(batch rewritten, no outbox event anywhere in the file).

## Fix

For every batch it adjusts, `RecalculateMDR` inserts a `settlement.batch_closed` outbox event with
the new gross/fee/net (same `buildBatchClosedPayload` as `CloseBatch`), in the same transaction as
the rewrite. Reporting's existing upsert then overwrites the stale row; on replay the later event
wins. Only reporting consumes this event type (the merchant webhook dispatcher does not send it).

Options: (1) re-emit `settlement.batch_closed` ✅ (no consumer change); (2) new
`settlement.batch_adjusted` event + reporting handler (cleaner name, two apps to change);
(3) have reporting read `settlement_batches` directly (bigger change).

## Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestRecalculateMDR_EmitsUpdatedBatchFigures` | `apps/settlement/internal/settlement/recalculate_mdr_outbox_fix_test.go` | ❌ `latest batch event fee/net = 1000/39000, want 1200/38800` | ✅ passes |

`cd apps/settlement && go test -p 1 ./...` green. Existing tests changed: none.
