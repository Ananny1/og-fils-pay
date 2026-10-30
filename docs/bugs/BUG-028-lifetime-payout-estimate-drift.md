# BUG-028 — Lifetime payout estimate drifts (float32 / REAL)

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Settlement · Money |
| **Analysis ID** | S9 |
| **Clue** | `payout_estimate_test.go` note: "float32 exact up to 2^24 so small values are fine; big ones drift but nobody reads it" |
| **Commit** | see `git log --grep BUG-028` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

The ops "lifetime net payout" figure per merchant stops matching the sum of the merchant's paid
batches once it passes ~16,777 BD. Example: payouts of 16,777.217 + 0.001 + 123,456.789 + 0.003 BD
are stored as 140,234.000 BD instead of 140,234.010 BD; the error grows with every payout. Ops
uses it to flag "unusually large or small" settlement runs, so the check compares against a wrong
baseline.

## 2. Why it happened — the root cause

`apps/settlement/internal/settlement/payout_estimate.go:19` and `0040_…monitoring_estimate.sql`

```go
`, merchantID, float32(netPayoutFils))   // added into a REAL column
```

```sql
ADD COLUMN lifetime_net_payout_monitoring_estimate REAL NOT NULL DEFAULT 0;
```

`REAL`/`float32` have a 24-bit mantissa, so above 16,777,216 fils each addition rounds to the
nearest representable value. `EstimateMonthlyPayout` also summed in `float32`.

False claim: "Monitoring only … nothing reads it back into a money calculation" — it is still a
money figure people act on, and ADR-0001 has no monitoring exception.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| FilsPay ops | wrong baseline for payout anomaly checks on large merchants | Medium |
| Merchants | none directly | — |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0078_lifetime_payout_estimate_bigint.sql` | column → `BIGINT`; recompute each merchant's value as `SUM(net_payout_fils)` of its paid batches (the drift cannot be repaired by a cast) |
| `apps/settlement/internal/settlement/payout_estimate.go` | pass `int64(netPayoutFils)`; `EstimateMonthlyPayout` sums and returns `money.Fils` |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | BIGINT + int64 + one-off recompute | exact, matches every other fils column | migration | ✅ |
| 2 | Drop the column, compute on read | no drift possible | wider change, callers/dashboards | |
| 3 | `DOUBLE PRECISION` | small change | still a float (ADR-0001) | |

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `TestUpdateLifetimePayoutMonitoringEstimate_LargeValuesExact` | `apps/settlement/internal/settlement/payout_estimate_fix_test.go` | ❌ `140234000`, want `140234010` | ✅ |

```bash
npm run migrate
cd apps/settlement && go test ./internal/settlement/ -run LargeValuesExact -count=1
```

Existing tests changed: none. Note: `db/seed/generate.ts` still simulates the old float drift with
`Math.fround` (writes integer-valued floats, so it still loads); it should sum plain integers.
The split payout path (`splits.PayoutSplitBatch`) never updates this total — the migration's
recompute includes those batches, but later split payouts will not be added (reported, not fixed).
