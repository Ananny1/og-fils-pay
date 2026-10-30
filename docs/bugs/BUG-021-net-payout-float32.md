# BUG-021 — Net payout computed in float32

| | |
|---|---|
| **Severity** | High |
| **Area** | Money · Settlement |
| **Analysis ID** | S2 (see `docs/challenge/ANALYSIS.md`) |
| **Decision** | D-016 (4-hour sprint, stream S5) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** a merchant's daily net payout could be off by one or more fils.
- **Why:** gross and fee were turned into BD as `float32` numbers, subtracted, then turned
  back into fils. `float32` keeps only about 7 digits, so from ~16,777 BD up the last fils are lost.
- **What it breaks:** a 20,000.001 BD batch paid out 20,000.000 BD. Bigger batches drift by
  more (123,456.789 BD − fee was 2 fils too high). Payout no longer equals gross − fee.

## 1. The issue

`CloseBatch` (`batch.go:219`) uses `NetPayableFils(batchGross, batchFee)` for the batch net and
the payout ledger posting. For a batch of 20,000,001 fils with no fee, it returned 20,000,000.

## 2. Why it happened — the root cause

`apps/settlement/internal/settlement/payable.go`:

```go
// before
netBD := float32(grossFils)/1000 - float32(feeFils)/1000
return money.Fils(math.Round(float64(netBD) * 1000))
```

Money must stay integer fils (1 BD = 1000 fils). `float32` has a 24-bit mantissa
(16,777,216), so any value above that many fils cannot be stored exactly.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants with big days (>16,777 BD) | Paid a few fils short or over | Medium; grows with volume |
| FilsPay finance | `net != gross − fee`; ledger and batch do not reconcile | High |

## 4. The fix

| File | Change |
|---|---|
| `apps/settlement/internal/settlement/payable.go` | `return grossFils - feeFils` (integer fils); `math` import removed |

```go
// after
func NetPayableFils(grossFils, feeFils money.Fils) money.Fils {
	return grossFils - feeFils
}
```

Smallest correct change: the function keeps its name and signature, so `batch.go` is untouched.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Integer subtraction `gross − fee` | Exact; simplest; matches house rule "money is integer fils" | none | ✅ |
| 2 | Switch to `float64` | Small diff | Still floats; exact only up to 2^53 fils and against the money rule | |
| 3 | Compute net in SQL (`gross_fils - fee_fils`) | DB is integer too | Moves logic; bigger change | |
| 4 | (creative) Drop `net` entirely and always derive it at read time | No stored drift ever | Schema and report changes; out of scope | |

**Why we chose #1:** it is exact for every int64 value and is one line.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestNetPayableFils_ExactForLargeBatches` | `apps/settlement/internal/settlement/payable_test.go` | ❌ 20,000,001 → 20,000,000; 123,456,789−2,469,135 → 120,987,656 (want …654) | ✅ |
| Full Go suite | `apps/settlement` | ✅ | ✅ |

```bash
cd apps/settlement && go test ./internal/settlement/ -run NetPayable
```

Existing tests changed: none.
