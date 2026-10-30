# BUG-016 — Marketplace split children don't add up to the parent's net payout

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Settlement · Money |
| **Analysis ID** | S5 |
| **Clue** | Delta Marketplace split payouts short; `0045` note (FH: "splits each child with ApplyRateFils, not allocateRemainder. filed FP-250"; AM: "FP-250 closed") |
| **Commit** | see `git log --grep BUG-016` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

A marketplace parent with sub-merchants is paid out across its children by weight. The children's
shares do not add up to the batch's net payout. A 10.001 BD net split three ways (33.33/33.33/
33.34 %) pays 10.000 BD; 1 fils stays in the parent's `merchant_payable` and is never paid. With
seven children the sum can even be **more** than the net (999.999 BD → 1,000.000 BD paid).

## 2. Why it happened — the root cause

`apps/settlement/internal/splits/allocate.go:98` and `shares.go:14`

```go
share := money.ApplyRateFils(money.Fils(netPayout), weightBps)   // each child rounded on its own
```

Rounding each share independently (banker's rounding) loses or invents up to one fil per child.
Nothing reconciles the sum back to `netPayout`, although `SplitPayoutResult`'s doc says "Shares
always sum to the batch's net_payout_fils". `packages/money` already has the right algorithm
(`allocateRemainder`, largest remainder) but the Go port never used it.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Sub-merchants (marketplace children) | paid a few fils short (or over) every batch | High — every split batch |
| Parent merchants | residual stuck in `merchant_payable`, balance never reaches 0 | Medium |
| FilsPay finance | `settlement_batch_splits` total ≠ `net_payout_fils` | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/settlement/internal/splits/shares.go` | `ChildShares` = largest-remainder allocation (floor, then +1 fil to the largest remainders, ties by lowest index), weights relative to their own sum |
| `apps/settlement/internal/splits/allocate.go` | `PayoutSplitBatch` collects the weights and uses `ChildShares` instead of per-child `ApplyRateFils` |

The sum is exactly `netPayout` by construction, so the parent's payable clears and the cache
delta (`totalAllocated`) equals the batch's net. Weights are taken relative to their sum, so a
misconfigured parent whose weights don't total 10000 still pays out the whole net instead of
leaving money behind.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Largest remainder (port of `allocateRemainder`) | exact, deterministic, same rule as TS | — | ✅ |
| 2 | Round each, give the difference to the last child | simple | biased to one child; can go negative | |
| 3 | Leave residual with the parent and sweep later | no code change | money never paid; manual work | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestChildShares_SumToNetWithRemainders` | `apps/settlement/internal/splits/allocate_fix_test.go` | ❌ 10001 → 10000; 999999 → 1000000 | ✅ |
| `TestPayoutSplitBatch_ChildrenAddUpToNet` | same | ❌ allocated 10000/10001, parent payable 1 | ✅ allocated 10001, payable 0, cache 0 |

```bash
cd apps/settlement && go test ./internal/splits/ -count=1
```

Existing tests changed: none (`TestChildShares_SumToNet` used only round numbers, so it passed with
the bug).
