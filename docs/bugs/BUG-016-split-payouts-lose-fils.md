# BUG-016 — Split payouts lose (or invent) fils — Delta Marketplace

| | |
|---|---|
| **Severity** | High |
| **Area** | Money · Settlement |
| **Analysis ID** | S5 (see `docs/challenge/ANALYSIS.md`) |
| **Decision** | D-016 (4-hour sprint, stream S5) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** when a marketplace (Delta Marketplace, split 50 / 30 / 20 %) is paid out to its
  sub-merchants, the child payouts do not add up to the batch net.
- **Why:** each child's share was rounded **on its own** (`ApplyRateFils`, bankers' rounding).
  The rounding errors do not cancel, so the total is often 1–2 fils off.
- **What it breaks:** net 1,001 fils → 500 + 300 + 200 = **1,000** paid; 1 fils stays in the parent's
  payable forever. Net 9,999 fils → 5,000 + 3,000 + 2,000 = **10,000**: 1 fils paid that was never
  earned. Ledger, batch and balance cache stop agreeing.

## 1. The issue

`PayoutSplitBatch` (`apps/settlement/internal/splits/allocate.go`) pays a split parent's batch
net to its children. For net 1,001 with weights 5000/3000/2000 bps it posted 1,000 fils of payout
legs and marked the batch `paid`. It then reduced the cached balance by 1,000, not by the batch net.

## 2. Why it happened — the root cause

```go
// before (allocate.go)
share := money.ApplyRateFils(money.Fils(netPayout), weightBps)
...
balances.ApplyPayout(ctx, tx, parentMerchantID, batchID, totalAllocated)
```

`shares.go ChildShares` had the same per-child rounding. The TS money package already has the
correct algorithm (`allocateRemainder`, largest remainder); the Go side never ported it.

False claims that hid it (for `TRAPS.md`):
- `allocate.go` `SplitPayoutResult` doc: "Shares always sum to the batch's net_payout_fils" — false before this fix.
- `db/migrations/0045_*.sql`: "AM: FP-250 closed, the seed always writes 10000" — weights summing to
  10000 does not help; per-child rounding still loses fils (the seed's 5000/3000/2000 sums to 10000 and fails).
- `packages/money/src/allocate_drift_known.test.ts` names correct behaviour "known drift" — the TS
  function is right; only the Go port was missing.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Sub-merchants (Delta Marketplace children) | Paid up to (children − 1) fils short or over per batch | Low per day, adds up |
| Parent merchant | Fils stuck in `merchant_payable` that are never paid | Medium |
| FilsPay finance | Ledger payout ≠ batch net; cached balance drifts | High (reconciliation) |

## 4. The fix

| File | Change |
|---|---|
| `apps/settlement/internal/splits/shares.go` | `ChildShares` = largest-remainder allocation (port of TS `allocateRemainder`): floor each share, give leftover fils one each to the largest remainders, ties to the lower index. Sums to net exactly. |
| `apps/settlement/internal/splits/allocate.go` | `PayoutSplitBatch` uses `ChildShares`; passes `netPayout` (not `totalAllocated`) to `balances.ApplyPayout`, like `PayoutBatch`; refuses to commit if shares ≠ net (guard). |

Shares are divided by the **sum of weights**, so even if a future admin tool saves weights that
do not total 10000, the whole net is still paid out (nothing left in the parent).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Largest-remainder allocation (port `allocateRemainder`) | Exact; same result as TS; fair (biggest fraction gets the fils) | ~30 lines | ✅ |
| 2 | Give the whole remainder to the last (or largest) child | Very small change | Not fair; differs from the TS rule | |
| 3 | Leave remainder in parent and post a "split rounding" ledger line | Visible in the ledger | Money still not paid out; new account needed | |
| 4 | (creative) Rotate the extra fils across children day by day | Fair over time | Needs state per parent; harder to audit | |

**Why we chose #1:** it is the rule the money package already defines, so Go and TS agree, and the shares always add up to net.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestPayoutSplitBatch_PaysWholeNet` (DB, 50/30/20, net 1001) | `apps/settlement/internal/splits/allocate_test.go` | ❌ splits=1000 ledger=1000 | ✅ 1001 / 1001 |
| `TestChildShares_SumToNet` (new cases delta 1001 / 9999 / 7, thirds) | `apps/settlement/internal/splits/shares_test.go` | ❌ 1000, 10000, 1002, 99 | ✅ |
| `TestChildShares_MatchesTSAllocateRemainder` | same | ❌ [500 300 200] | ✅ [501 300 200], same as TS |
| Full Go suite | `apps/settlement` | ✅ | ✅ |

```bash
cd apps/settlement && DATABASE_URL=... go test ./internal/splits/
```

Existing tests changed: none (cases added only).
