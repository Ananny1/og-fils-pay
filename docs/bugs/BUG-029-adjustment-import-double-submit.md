# BUG-029 — Adjustment import has no double-submit guard

| | |
|---|---|
| **Severity** | High |
| **Area** | Money |
| **Analysis ID** | B3 (see `docs/challenge/ANALYSIS.md`) |
| **Clue** | ADMIN.md: "Don't submit the same file twice; there's no duplicate detection yet." |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** if finance double-clicks "Import" or uploads the same CSV again, every correction is **posted twice**. Merchants get double credits or double debits.
- **Why:** nothing checks whether the same rows were already applied. Each upload makes a new import row and new ledger postings.
- **What it breaks:** merchant balances and the ledger, by the full amount of the file, for every repeat.

## 1. The issue

`POST /v1/admin/adjustment-imports` twice with the same `csvContent` → two imports, two ledger groups per row, cached balance moved twice. Two concurrent requests (double-click) do the same.

## 2. Why it happened — the root cause

`apps/api/src/admin/adjustmentImport.ts` `applyAdjustmentImport` inserts a new `adjustment_imports` row on every call; the table (`db/migrations/0065`) has no unique key on content or filename.

False claims that hid it (traps):
- `adjustmentImport.ts` — "re-upload is blocked by the unique original_filename i think — am". **False**: `original_filename` has no unique constraint (0065), and a filename check would not stop "file (1).csv" anyway.
- `routes/adminAdjustmentImport.ts` — "MK: finance checks the spreadsheet before uploading. fine for now". Checking the sheet does not stop a double-click.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Corrections applied twice (overpaid or over-debited) | High |
| FilsPay finance | Ledger and cached balances off by the whole file; manual reversal needed | High |
| Customers / scheme | Not directly | — |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0087_adjustment_import_content_hash.sql` | New nullable `content_hash` column + partial unique index. |
| `apps/api/src/admin/adjustmentImport.ts` | Hash the parsed rows (merchant id, amount in fils, reason) with SHA-256; store it on insert; a unique violation becomes `409 duplicate_import` "this CSV has already been applied". Removed the false comment. |
| `apps/api/src/routes/adminAdjustmentImport.ts` | Comment updated. |
| `docs/ADMIN.md` | Says duplicates are now refused. |
| `db/migrations/0088_adjustment_import_hash_per_day.sql` | (review fix) New `content_day DATE NOT NULL DEFAULT` today's Asia/Bahrain date (old rows back-filled from `created_at`); the 0087 unique index is replaced by one on `(content_hash, content_day)`. |
| `apps/api/src/admin/adjustmentImport.ts` | (review fix) rows are **sorted** before hashing, so reordering the CSV no longer bypasses the guard; message now "already been applied today". |

**Review fix — why.** The first version had two holes: (a) the hash depended on row order, so swapping two lines let the same money post again; (b) the unique index was global and permanent, so an identical, legitimate correction (same merchant, amount, reason) next month was refused forever. The guard exists to stop a double-click or re-upload, which happen within minutes, so it is now scoped to the settlement day (midnight Asia/Bahrain).

**Trade-off (recorded):** a re-upload that crosses Bahrain midnight (e.g. 23:59 and 00:01) is accepted twice. The window is a choice between "block real repeats" and "never block a real correction"; one Bahrain day matches how finance works (one statement run per day) and keeps the rule simple. A genuine second identical correction on the same day still needs a different reason text.

The hash uses the **parsed** fils, so `4.75` and `4.750` count as the same row, and the filename is ignored. The unique index makes the database itself refuse the second insert, so two simultaneous clicks cannot both pass (the second waits for the first transaction, then fails and rolls back with no postings).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Content hash of parsed rows + unique index | DB-enforced; catches re-uploads and double-clicks; no UI change | A genuine identical correction must be changed (e.g. a different reason) to re-apply | ✅ |
| 2 | Client-sent idempotency key (like the payments API) | Standard pattern | Only stops retries of the same request, not a re-upload; needs UI change | |
| 3 | Unique `original_filename` | Trivial | Wrong key: same file renamed passes, different files with the same name blocked | |
| 4 | Two-step import: upload → preview with totals → confirm token used once (creative) | Also catches the 10× style errors (BUG-014) before money moves | New table/state + UI; too big for the sprint | |

Review follow-up (scope of the guard), options: (1, chosen) sorted rows + unique per `(hash, Bahrain day)`: DB-enforced, race-proof, simple; (2) rolling 24 h window checked in SQL before insert: no midnight edge, but a check-then-insert is racy without an extra lock and cannot be a unique index; (3) keep it global but add an admin "apply anyway" override: keeps full protection, needs UI and audit work; (4) hash the sorted rows only, no window: fixes reordering but still refuses next month's correction.

**Why we chose #1:** it is the smallest change that the database enforces, covering both the race and the re-upload.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-029: the same CSV content applied twice is rejected the second time` | `apps/api/src/admin/adjustmentImport.test.ts` | ❌ second apply succeeded, 2 ledger groups | ✅ rejected, 1 group |
| `BUG-029: two simultaneous submits of the same CSV post once` | same | ❌ both succeeded, balance 4000 | ✅ one succeeds, balance 2000 |
| `BUG-029: the same rows in a different order are rejected the second time` (review) | `apps/api/src/admin/adjustmentImport.test.ts` | ❌ "Missing expected rejection" (reorder bypassed the guard) | ✅ rejected |
| `BUG-029: the same rows on a later Bahrain day are accepted` (review; first import back-dated 30 days) | same | ❌ refused forever (no `content_day`) | ✅ accepted, balance 6000 |
| `BUG-029: uploading the same CSV twice is a 409 the second time` | `apps/api/src/routes/adminAdjustmentImport.test.ts` | — (written with the fix) | ✅ 201 then 409 |

```bash
npx tsx --test apps/api/src/admin/adjustmentImport.test.ts apps/api/src/routes/adminAdjustmentImport.test.ts
```

Existing tests changed (and why): none. Migrations 0087 and 0088 must be applied (`migrate`) before the API runs.
