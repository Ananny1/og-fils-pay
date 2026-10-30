# FP-300.7 — Payouts show the refunds a batch took off

| | |
|---|---|
| **Area** | Refunds (FP-300) · Merchant Payouts pages |
| **Status** | ✅ done |

## Summary
Since FP-300.3 a batch's net is `gross − fee − refund cost`, but the Payouts list and batch page only
showed gross, fee and net. After a refund the shop saw net ≠ gross − fee with nothing explaining it
(30 Oct test: 104.750 − 2.357 shown, net 46.812, 55.581 unexplained).

## The change
| File | Change |
|---|---|
| `apps/api/src/settlement/query.ts` | `refundsFils` on every batch = gross − fee − net for a closed/paid batch (the invariant CloseBatch enforces; no extra query per row); 0 for an open batch |
| `apps/web/src/types.ts` | `refundsFils` on `SettlementBatchDto` |
| `apps/web/src/pages/settlement/SettlementBatchListPage.tsx` | Refunds column |
| `apps/web/src/pages/settlement/SettlementBatchDetailPage.tsx` | Refunds card; net hint "Sales minus the fee and refunds" |

## Options considered
| Rank | Option | Chosen? |
|---|---|---|
| 1 | Derive from frozen totals | ✅ exact, free |
| 2 | `SUM` over `refunds` by `settlement_batch_id` per batch | needs a new index (0042's is partial on unbatched rows) |
| 3 | New `refunds_fils` column written at close | migration + Go change for an implied value |

## Proof
Browser, 30 Oct batch for Alpha Retail: Gross 104.750 · Fee 2.357 · Refunds −55.581 · Net 46.812
(55.581 = 57.006 refunded − 1.425 fee given back; ledger checked). API and web type-check; API suite green.
