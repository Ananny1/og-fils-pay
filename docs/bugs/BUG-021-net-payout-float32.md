# BUG-021 — Net payout computed through float32

| | |
|---|---|
| **Severity** | High |
| **Area** | Settlement · Money |
| **Analysis ID** | S2 |
| **Clue** | ADR-0001 (integer fils only) |
| **Commit** | see `git log --grep BUG-021` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

For any batch above about 16,777 BD the merchant's net payout is off by a few fils. Example:
gross 20,000.001 BD, fee 500.000 BD → paid 19,500.000 BD instead of 19,500.001 BD. A batch of
123,456.789 BD gross loses 3 fils.

## 2. Why it happened — the root cause

`apps/settlement/internal/settlement/payable.go:10-12`

```go
netBD := float32(grossFils)/1000 - float32(feeFils)/1000
return money.Fils(math.Round(float64(netBD) * 1000))
```

`float32` has a 24-bit mantissa (≈ 7 significant digits). 20,000.001 cannot be represented, so
the fils digit is lost before rounding back. Every close (`batch.go` step 8) uses this value for
`settlement_batches.net_payout_fils`, the payout ledger legs and the balance cache.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants with large daily batches | paid a few fils more or less than gross − fee | Medium (small amounts, every large batch) |
| FilsPay finance | `gross − fee ≠ net` on frozen batches; ledger payable doesn't clear to 0 | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/settlement/internal/settlement/payable.go` | `return grossFils - feeFils` (integer) |

Integer subtraction is exact; nothing else depends on the float path.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Integer subtraction | exact, ADR-0001 | none | ✅ |
| 2 | Switch to float64 | smaller precision loss | still floats; fails above 2^53 and violates ADR-0001 | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestNetPayableFils_ExactForLargeBatches` | `apps/settlement/internal/settlement/payable_fix_test.go` | ❌ `NetPayableFils(20000001, 500000) = 19500000` | ✅ `19500001` |

```bash
cd apps/settlement && go test ./internal/settlement/ -run NetPayableFils_Exact -count=1
```

Existing tests changed: none.
