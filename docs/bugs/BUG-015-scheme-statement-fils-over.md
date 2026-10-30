# BUG-015 — Scheme statement always a few fils over

| | |
|---|---|
| **Severity** | High |
| **Area** | Money · Settlement · Card scheme |
| **Analysis ID** | S3 (see `docs/challenge/ANALYSIS.md`) |
| **Decision** | D-016 (4-hour sprint, stream S5) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** the clearing file sent to the card scheme claims more money than FilsPay
  recorded. A 93.275 BD sale was sent as **93.28** while `amount_fils` (and the ledger residue) used **93.27**.
- **Why:** the file's `amount` column was filled from the **untruncated** gross as a float
  (`93.275`), and Postgres `NUMERIC(10,2)` **rounds half-up** on assignment. `amount_fils` was truncated.
  The file is built from `amount`, not `amount_fils`.
- **What it breaks:** every line ending in 5–9 fils is up to 10 fils over (one case: 999.999 BD → "1000.00").
  The scheme statement never matches our ledger, and the ADR-0002 rounding-residue journal is wrong.

## 1. The issue

Close a batch with captures 4,747 / 1,005 / 93,275 / 999,999 fils. The scheme file shows
`4.75, 1.01, 93.28, 1000.00`. ADR-0002 says it must be exactly `amount_fils / 1000`:
`4.74, 1.00, 93.27, 999.99`.

## 2. Why it happened — the root cause

```go
// before — batch.go CloseBatch
truncated := TruncateToSchemeAmount(line.grossFils)
... VALUES ($1, $2, $3, $4, $5)`, batchID, line.transactionID, int64(truncated), SchemeAmountBD(line.grossFils), i+1)

// scheme_export.go
func SchemeAmountBD(grossFils money.Fils) float64 { return float64(grossFils) / 1000.0 }
```

`LoadSchemeExportLines` prefers `amount` (`COALESCE(sel.amount, …)`), so the rounded value went into the file.

False claims that hid it (for `TRAPS.md`):
- `db/migrations/0050_*.sql`: "MK: amount is amount_fils/1000 cut to two decimals, i.e. the same truncation
  as TruncateToSchemeAmount. file and fils always agree." False: NUMERIC(10,2) rounds, and the input was the untruncated gross.
- `scheme_export_test.go`: "4747 -> "4.75" passes the regex … it rounds. whatever" — the only test checked the format, not the value.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Card scheme / acquirer | Clearing file over-states each line by up to 10 fils | High: statement never reconciles |
| FilsPay finance | `scheme_rounding_residue` (gross − amount_fils) does not match the file | High |
| Merchants | Not directly (payout uses fils) | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/settlement/internal/settlement/scheme_export.go` | `SchemeAmountBD` now takes the **truncated** fils and returns an exact `"D.DD"` string via `formatFilsAsTwoDecimalString` (integer maths, no float) |
| `apps/settlement/internal/settlement/batch.go` | Passes `truncated` instead of `line.grossFils` |

Postgres parses the string exactly into `NUMERIC(10,2)`, so there is nothing left to round.
The seed (`db/seed/generate.ts`) already writes the truncated value, so it needs no change.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Store the truncated value as an exact string | Exact; matches ADR-0002; 2 small edits | none | ✅ |
| 2 | Pass `float64(truncated)/1000` | One-word change | Still floats; relies on NUMERIC rounding a float that is already near-exact | |
| 3 | Make the file read `amount_fils` only (ignore `amount`) | One source of truth | Leaves a wrong column for support queries; changes the read path | |
| 4 | (creative) A DB `CHECK (amount = amount_fils::numeric / 1000)` | Database rejects any future drift | Fails on existing wrong rows until they are corrected; needs a migration | |

**Why we chose #1:** it fixes the writer at the source with integer maths, and the existing reader keeps working.

**Follow-up (not done here):** rows already written with a rounded `amount` stay as sent to the
scheme. Finance should decide whether to correct them (a one-off `UPDATE … SET amount = amount_fils::numeric/1000`)
or leave them as the record of what was sent.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestSchemeExportAmountEqualsTruncatedFils` | `apps/settlement/internal/settlement/scheme_export_test.go` | ❌ file `[1.01 1000.00 12.34 4.75 93.28]`, 4 rows `amount ≠ amount_fils/1000` | ✅ `[1.00 12.34 4.74 93.27 999.99]`, 0 mismatches |
| `TestSchemeExportAmountHasTwoDecimals` (existing) | same | ✅ | ✅ |
| Full Go suite | `apps/settlement` | ✅ | ✅ |

```bash
cd apps/settlement && DATABASE_URL=... go test ./internal/settlement/ -run SchemeExport
```

Existing tests changed: none (new test added).
