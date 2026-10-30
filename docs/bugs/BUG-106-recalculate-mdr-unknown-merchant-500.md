# BUG-106 — Recalculate MDR: unknown merchant is a 500, backwards date range is accepted

| | |
|---|---|
| **Severity** | Low |
| **Area** | Settlement internal API · Input validation |
| **Analysis ID** | new (bug hunt) |
| **Commit** | see `git log --grep BUG-106` |
| **Owner** | Sayed |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** `POST /internal/recalculate-mdr` with a well-formed merchant id that does not exist answers **500 `recalculate_mdr_failed`**. A range with `from >= to` answers **200** and silently does nothing.
- **Why:** the "no rows" error from loading the merchant is treated like a database failure, and the handler never checks the order of the dates.
- **What it breaks:** a typo looks like an outage (500 alerts, retries); finance thinks a backwards range "ran fine" when nothing was recalculated.

## 1. The issue

```
POST /internal/recalculate-mdr {"merchantId":"<random uuid>","from":"2026-04-01","to":"2026-05-01"}
→ 500 {"error":"recalculate_mdr_failed"}   (log: load merchant: no rows in result set)
POST /internal/recalculate-mdr {"merchantId":"<real>","from":"2026-05-01","to":"2026-04-01"}
→ 200 {"batchesConsidered":0,"adjusted":[]}
```

## 2. Root cause

- `apps/settlement/internal/settlement/recalculate_mdr.go`: `pgx.ErrNoRows` from the merchant
  lookup is wrapped as a generic error; the handler maps every error to 500.
- `apps/settlement/internal/internalapi/server.go` `handleRecalculateMDR`: parses `from` and `to`
  but never checks `from < to` for the half-open range `[from, to)`.

**Present in the original code:** `apps/settlement/internal/settlement/recalculate_mdr.go:60` and
`apps/settlement/internal/internalapi/server.go:316,323` at 8b58b0f.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Finance / ops | Typo looks like a server error; backwards range reports success with no work | Low |
| Merchants / cardholders | — | none |

## 4. The fix

| File | Change |
|---|---|
| `recalculate_mdr.go` | new `ErrMerchantNotFound`, returned when the merchant row is missing |
| `server.go` | `from >= to` → 400 `invalid_range`; `ErrMerchantNotFound` → 404 `merchant_not_found` |

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Sentinel error from RecalculateMDR + range check in handler | Tiny, same style as `ErrMerchantNotEligible` | — | ✅ |
| 2 | Pre-check merchant in the handler with its own query | No change to settlement pkg | Extra query, race with the tx | |
| 3 | Swap from/to when backwards | Lenient | Guesses intent | |

## 6. Proof

Tests: `apps/settlement/internal/internalapi/recalculate_mdr_fix_test.go`
(`TestRecalculateMDR_UnknownMerchantIs404`, `TestRecalculateMDR_EmptyOrBackwardsRangeIs400`).

Before:
```
--- FAIL: TestRecalculateMDR_UnknownMerchantIs404 (0.01s)
    recalculate_mdr_fix_test.go:18: status = 500, want 404 for an unknown merchant
--- FAIL: TestRecalculateMDR_EmptyOrBackwardsRangeIs400 (0.01s)
    recalculate_mdr_fix_test.go:35: "from":"2026-05-01","to":"2026-04-01": status = 200, want 400
    recalculate_mdr_fix_test.go:35: "from":"2026-05-01","to":"2026-05-01": status = 200, want 400
FAIL	github.com/filspay/settlement/internal/internalapi	1.299s
```
After:
```
ok  	github.com/filspay/settlement/internal/internalapi	1.326s
```
Full Go suite (`go test -count=1 -p 1 ./...`) and `go vet` green.
