# BUG-054 — Reconciliation's pending estimate uses `merchants.mdr_bps`, not the fee schedule

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Money · Settlement reporting |
| **Clue** | Comment in `settlement/query.ts`: "merchants.mdr_bps is kept in sync ... by the 0046 trigger" |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

`GET /v1/settlement/reconciliation` must explain the ledger: ledger net = paid batches + not-yet-batched
captures. For any merchant on a negotiated rate (a `fee_schedules` row), the "pending" part was computed
with the merchant's default rate, so the report showed an unexplained gap (`explained: false`) every
day there were unbatched captures. Example: default 250 bps, schedule 225 bps, 100.000 BD capture →
ledger 97 750 fils, pending 97 500 → 250 fils "missing".

## 2. Why it happened — the root cause

`apps/api/src/settlement/query.ts` `getReconciliationReport` (before):

```ts
// MK: merchants.mdr_bps is kept in sync with the current fee_schedules row by the 0046 trigger
const mdrBps = merchant?.mdr_bps ?? 0;
...
const feeFils = estimateFeeFils(amountFils, mdrBps, discountBps);
```

There is no such trigger: `0046` is `settlement_batch_splits.sql`, and no migration has a trigger on
`fee_schedules`. Capture (`getEffectiveMdrBps` at the capture instant, minus the volume-tier bonus) and
CloseBatch (`EffectiveMdrBpsAt(event time)` minus tier) both use the schedule. Also
`fees/estimate.ts` used float rates and `Math.round` (ADR-0001 forbids floats for money) instead of the
integer `ComputeSettlementFee` formula the batch uses.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants on negotiated rates | Reconciliation shows money "missing" | Medium |
| FilsPay finance | False alarms; real gaps hidden in noise | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/settlement/query.ts` | Load the merchant's fee schedules + volume-tier bonus; per pending event resolve the rate in effect at `te.occurred_at` (fallback `merchants.mdr_bps`), minus tier |
| `apps/api/src/fees/estimate.ts` | Integer formula identical to Go `ComputeSettlementFee` (`applyRateFils` on the discounted amount) |
| `apps/api/src/fees/platformVolumeTier.ts` | `getVolumeTierBonusBps` accepts a `Pool` as well as a `PoolClient` (type only) |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Resolve the schedule per event, like CloseBatch | Same answer as the batch that will settle it | A few lines | ✅ |
| 2 | Read the fee actually journalled per capture from `ledger_entries` | Exact | Reconciliation becomes circular (explains the ledger with the ledger) | |
| 3 | Add the trigger the comment describes | Keeps old code | `merchants.mdr_bps` is a single "now" value — still wrong for past events after a rate change | |

## 6. Proof — tests

| Test | File | Before | After |
|---|---|---|---|
| 225 bps schedule, 250 default → gap 0 | `apps/api/src/settlement/reconciliation.new.test.ts` | ❌ pending 97 500 vs ledger 97 750 | ✅ |
| existing reconciliation route tests | `apps/api/src/routes/settlement.test.ts` | ✅ | ✅ |

```bash
cd apps/api && npx tsx --test src/settlement/reconciliation.new.test.ts src/routes/settlement.test.ts
```

Existing tests changed: none.
