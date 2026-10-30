# BUG-041 — Scheme rounding residue is never journaled (ADR-0002 "implemented" but isn't)

| | |
|---|---|
| **Severity** | High |
| **Area** | Settlement · Money |
| **Analysis ID** | S4 |
| **Clue** | ADR-0002 status "Accepted, implemented (CloseBatch, 2026-03)" vs HANDOVER "nothing posts residue yet" |
| **Commit** | see `git log --grep BUG-041` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

The scheme only takes two decimals, so each exported line drops 0–9 fils. ADR-0002 says those fils
are journaled per line at close so that ledger, settlement report and scheme statement agree.
They are not: after a close, `card_scheme_clearing` still holds the full gross, the scheme pays the
truncated amount, and the difference sits unexplained. Finance had to chase it by hand every month
(and the March sweep script, BUG-027, was the workaround).

## 2. Why it happened — the root cause

`apps/settlement/internal/settlement/batch.go` (scheme line loop, ~line 250) inserts
`scheme_export_lines` and nothing else — there is no ledger posting for `gross - amount_fils`
anywhere in `apps/settlement` (`grep scheme_rounding_residue` finds only the chart-of-accounts seed
and the March script).

```go
for i, line := range lines {
	truncated := TruncateToSchemeAmount(line.grossFils)
	_, err = tx.Exec(ctx, `INSERT INTO scheme_export_lines ...`)
	// no residue group
}
```

False claim: ADR-0002 "Implementation notes: Implemented inside CloseBatch". HANDOVER (higher in
the trust order for facts about state) says it was never done.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | none (payout unchanged) | — |
| FilsPay finance | `card_scheme_clearing` never clears to zero against the scheme; month-end manual sweep | Medium, every line |
| Auditors | ADR says one thing, ledger another | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/settlement/internal/settlement/batch.go` | after each `scheme_export_lines` insert, if `gross - truncated > 0`, post one balanced group: `card_scheme_clearing` credit / `scheme_rounding_residue` debit, tagged with merchant, transaction and batch |

```go
if residue := line.grossFils - truncated; residue > 0 {
	INSERT INTO ledger_entries ... ('card_scheme_clearing','credit',residue), ('scheme_rounding_residue','debit',residue)
}
```

Exactly the ADR-0002 legs, inside the same transaction as the line, so a line and its residue
commit or roll back together. Zero-residue lines post nothing (`amount_fils > 0` CHECK).
`merchant_payable` is not touched, so balances and payouts are unchanged.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Per-line group in CloseBatch (ADR-0002 option A) | auditable per line, atomic with the export | one extra group per line | ✅ |
| 2 | One group per batch with the summed residue | fewer rows | loses per-line trace the ADR asks for | |
| 3 | Monthly sweep script | no hot-path code | ADR rejected it; see BUG-027 | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestCloseBatch_JournalsSchemeRoundingResidue` | `apps/settlement/internal/settlement/scheme_residue_fix_test.go` | ❌ residue debit 0, want 12 | ✅ 12 fils in 2 groups; gross − exported = residue |

```bash
cd apps/settlement && go test ./internal/settlement/ -run Residue -count=1
```

Existing tests changed: none. Batches closed before this fix have no residue rows; a one-off
backfill (per line, `gross - amount_fils`) is a finance decision, not done here.
