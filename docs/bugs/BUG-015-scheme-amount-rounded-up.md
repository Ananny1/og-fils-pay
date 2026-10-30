# BUG-015 — Scheme file amount is rounded, not truncated (scheme always a few fils higher)

| | |
|---|---|
| **Severity** | High |
| **Area** | Settlement · Money |
| **Analysis ID** | S3 |
| **Clue** | `docs/exports/scheme/delta-wholesale-2026-09-14.*` — line 1: `amount_fils` 93270 but file says `93.28` |
| **Commit** | see `git log --grep BUG-015` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

Finance reconciles the card scheme statement against our `scheme_export_lines`. The scheme total is
always a few fils **higher** than ours. Example from the Delta Wholesale export of 14 Sep 2026: a
93.275 BD capture is stored as `amount_fils = 93270` but the file line sent to the scheme says
`93.28`. Every line whose third decimal is 5–9 is overstated by 10 fils minus the residue.

Reproduce: close a batch with a 93.275 BD capture, then
`SELECT amount_fils, amount FROM scheme_export_lines` → `93270 | 93.28`.

## 2. Why it happened — the root cause

`apps/settlement/internal/settlement/scheme_export.go:29` and `batch.go:255`:

```go
func SchemeAmountBD(grossFils money.Fils) float64 {
	return float64(grossFils) / 1000.0   // 93.275 (float, untruncated gross)
}
...
VALUES ($1, $2, $3, $4, $5)`, batchID, line.transactionID, int64(truncated), SchemeAmountBD(line.grossFils), i+1)
```

`amount_fils` gets the **truncated** value (93270), but `amount` gets the **untruncated gross**
as a float. The column is `NUMERIC(10,2)`, and Postgres **rounds** on assignment (half away from
zero): 93.275 → 93.28. The file writer (`LoadSchemeExportLines`) serialises `amount`, so the scheme
receives the rounded figure. ADR-0002 says the file amount "must be exactly `amount_fils / 1000`".

False claim that hid it: the comment in `0050_scheme_export_lines_acquirer_amount.sql`
("amount is amount_fils/1000 cut to two decimals … file and fils always agree"). AM's reply on the
same line ("NUMERIC(10,2) rounds on assignment though?") was right.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | none directly (payout is from `gross_fils - fee_fils`) | — |
| FilsPay finance | scheme statement never ties to the ledger; up to 9 fils per line claimed from the scheme that we never booked | Medium–High, every batch |
| Card scheme / acquirer | told amounts up to 10 fils higher than the truncated line | High (over-claim) |

## 4. The fix

| File | Change |
|---|---|
| `apps/settlement/internal/settlement/scheme_export.go:27` | `SchemeAmountBD` returns the truncated amount as an exact `"D.DD"` string via the existing integer formatter |

```go
func SchemeAmountBD(grossFils money.Fils) string {
	return formatFilsAsTwoDecimalString(TruncateToSchemeAmount(grossFils))
}
```

Smallest correct change: one function, no schema change, call site unchanged. It removes both
causes (untruncated input and float → NUMERIC rounding): the stored text is computed with integer
maths from the same truncated value written to `amount_fils`.

Existing rows written before the fix are already in files the scheme received, so they are not
rewritten; finance can find them with
`SELECT * FROM scheme_export_lines WHERE amount * 1000 <> amount_fils`.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Store `formatFilsAsTwoDecimalString(truncated)` | exact, integer-only, one function | none | ✅ |
| 2 | Pass `float64(truncated)/1000` | one-word change | still a float; relies on NUMERIC rounding a binary float correctly | |
| 3 | Drop `amount` and always serialise `amount_fils` | single source | schema change, touches reader + 0050 contract | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestSchemeAmountBD_IsTruncatedAmountFils` | `apps/settlement/internal/settlement/scheme_export_fix_test.go` | ❌ `93.275` | ✅ `93.27` |
| `TestCloseBatch_SchemeLineAmountMatchesAmountFils` | same | ❌ `amount 93.28 BD != amount_fils 93270 / 1000` | ✅ |

```bash
cd apps/settlement && go test ./internal/settlement/ -run 'SchemeAmountBD|SchemeLineAmount' -count=1
```

Existing tests changed: none.
