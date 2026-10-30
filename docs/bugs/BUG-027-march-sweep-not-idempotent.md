# BUG-027 — March residue sweep doubles the gap when run twice

| | |
|---|---|
| **Severity** | High |
| **Area** | Money · Reporting |
| **Analysis ID** | B5 (see `docs/challenge/ANALYSIS.md`), ticket FP-187 |
| **Clue** | Finance: "March still doesn't tie out on my side" (ONBOARDING, FP-187) |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** the one-off March sweep (`scripts/reconcile_march.ts`) posts the rounding residue **again every time it is run**. It also uses the **UTC** month instead of the Bahrain month, and it takes the residue **from the merchant's balance** instead of from card scheme clearing.
- **Why:** each run makes a new random `entry_group_id` and never checks for an earlier posting. The month window is `Date.UTC(...)` midnight. The ledger legs debit `merchant_payable`.
- **What it breaks:** a second run doubles the March write-off; transactions between 21:00 and 24:00 UTC on the last day of February are missed and those on 31 March after 21:00 UTC are wrongly included; merchants lose fils they are owed.

## 1. The issue

Run `npx tsx scripts/reconcile_march.ts` twice: every merchant gets two identical residue groups. Finance's March figure can't match the ledger.

## 2. Why it happened — the root cause

`scripts/reconcile_march.ts`:

```ts
// am: re-running is safe, entry_group_id dedupes it
const entryGroupId = randomUUID();                       // new every run -> no dedupe
... VALUES ($1, $2, 'merchant_payable', 'debit', ...),    // wrong account (ADR-0002)
           ($1, $2, 'scheme_rounding_residue', 'credit', ...)
return { start: new Date(Date.UTC(year, month - 1, 1)), ... } // UTC month
```

False claims that hid it (traps):
- `reconcile_march.ts` — "re-running is safe, entry_group_id dedupes it". **False**: the id is random per run.
- `docs/RUNBOOK.md` "Month-end residue" — "The script checks for an existing posting with the same description, so a second run is a no-op." **False** before this fix (now true). The same section told finance to use the **UTC** month; HANDOVER says "must use the Bahrain month, not a UTC month".
- ONBOARDING, MK: "[UTC month boundaries] not for a monthly total". **False**: the boundaries move 3 hours of traffic between months.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Residue was debited from `merchant_payable` (their money), twice if run twice | High (small fils, many merchants) |
| FilsPay finance | March books don't tie out; residue suspense account doubled | High |
| Card scheme / acquirer | Clearing account not credited, so it never reconciles with the scheme statement | Medium |

## 4. The fix

| File | Change |
|---|---|
| `scripts/reconcile_march.ts` | `postResidueCorrection` skips a merchant that already has a posting with the sweep description; the run takes a transaction advisory lock; legs are debit `scheme_rounding_residue` / credit `card_scheme_clearing` (ADR-0002); `monthBounds` returns the Bahrain month (21:00 UTC boundaries); the log marks skipped merchants. `postResidueCorrection` and `SWEEP_DESCRIPTION` exported for tests. |
| `scripts/reconcile_march.test.ts` | monthBounds test now expects Bahrain boundaries. |
| `scripts/reconcile_march.sweep.test.ts` | New DB test: run twice → one group, correct accounts. |
| `docs/RUNBOOK.md` | Month-end step 1 now says Bahrain month. |

Smallest correct change: the script's structure is kept; only the guard, the window and the two account names change.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Guard on existing description per merchant + advisory lock, Bahrain month, ADR-0002 legs | Small; makes the runbook claim true; safe to re-run | Description text becomes the key (must not be edited) | ✅ |
| 2 | Deterministic `entry_group_id` (UUIDv5 of merchant + month) with a unique index | Database-enforced dedupe | Needs a migration and a unique constraint on a ledger column | |
| 3 | A `reconciliation_runs` table storing month + status; refuse a second run | Clear audit trail of runs | New table + migration for a one-off script | |
| 4 | Dry-run by default; `--apply` only after finance confirms the printed totals (creative) | Human check before money moves | Doesn't stop a second `--apply` on its own | |

**Why we chose #1:** it removes the double-posting with no schema change and fixes the two other root causes in the same file.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-027: running the sweep twice posts the residue once, on the ADR-0002 accounts` | `scripts/reconcile_march.sweep.test.ts` | ❌ (no guard; random group per run; wrong accounts) | ✅ one group, `scheme_rounding_residue` debit / `card_scheme_clearing` credit |
| `BUG-027: the March window is the Bahrain month` | same | ❌ start `2026-03-01T00:00Z` | ✅ `2026-02-28T21:00Z` |
| `monthBounds for March 2026 spans 31 days of the Bahrain month` | `scripts/reconcile_march.test.ts` | ✅ (asserted UTC month) | ✅ (asserts Bahrain month) |

```bash
DATABASE_URL=... npx tsx --test scripts/reconcile_march.sweep.test.ts scripts/reconcile_march.test.ts
```

Existing tests changed (and why): `reconcile_march.test.ts` asserted the UTC month (`getUTCMonth() === 2`), which is the bug.

Note: this fixes the script for future runs. It does **not** reverse the postings of the earlier real March run; finance should compare `scripts/out/` with the ledger and post reversing entries if it was run twice.
