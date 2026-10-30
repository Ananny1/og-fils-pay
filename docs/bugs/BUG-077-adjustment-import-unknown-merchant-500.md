# BUG-077 — Adjustment CSV with a wrong merchant id crashes with 500

| | |
|---|---|
| **Severity** | Low–Medium (finance tool, bad input → 500) |
| **Area** | Admin · Money tools |
| **Commit** | see `git log --grep "BUG-077"` |
| **Status** | ✅ fixed |

**Present in the original code:** `apps/api/src/admin/adjustmentImport.ts:68` at 8b58b0f
(`postAdjustmentToLedgerAndCache(client, row.merchantId, amountFils)` with no existence check;
the route at `apps/api/src/routes/adminAdjustmentImport.ts:61` only checks the id is UUID-shaped).

## 1. The issue
Finance pastes a CSV where one merchant id has a typo (well-formed UUID, no such merchant).
`POST /v1/admin/adjustment-imports` answers `500 internal_error` and does not say which row is wrong.

## 2. Root cause
The route only checks `UUID_RE`. The service inserts ledger rows straight away; the
`ledger_entries.merchant_id` foreign key fails (23503) and the error handler turns it into a 500.

## 3. Who was affected
| Party | How | How bad |
|---|---|---|
| FilsPay finance | Import fails with a 500, no hint which row; error log noise | Low–Medium |

## 4. Fix
`applyAdjustmentImport` looks up all distinct merchant ids of the file in one query
(`id = ANY($1::uuid[])`, primary key) and throws `400 invalid_csv_row` naming the first unknown id,
inside the same transaction, so nothing from the file posts.

## 5. Options (ranked)
| Rank | Option | Chosen? |
|---|---|---|
| 1 | One `ANY()` lookup before posting, 400 with the id | ✅ |
| 2 | Map FK violation 23503 to 400 in the error handler | Generic message, doesn't name the row; hides real FK bugs elsewhere |
| 3 | Skip unknown rows | Silently drops money rows |

## 6. Proof
| Test | File | Before fix | After fix |
|---|---|---|---|
| `a row with an unknown merchant id is a 400 naming it, and no row of the file posts` | `apps/api/src/routes/adminAdjustmentImport.unknownMerchant.new.test.ts` | ❌ `500 !== 400` | ✅ pass |

`cd apps/api && npx tsx --test src/routes/adminAdjustmentImport.unknownMerchant.new.test.ts src/routes/adminAdjustmentImport.test.ts src/admin/adjustmentImport.test.ts` → 28 pass, 0 fail.
