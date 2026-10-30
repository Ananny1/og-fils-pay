# DEP-002 — A fresh database can't be migrated (0054, 0055)

| | |
|---|---|
| **Severity** | Blocker |
| **Area** | Deploy / database |
| **Analysis ID** | D3 |
| **Clue** | HANDOVER: "0039, 0041, 0054–56 are PRs I abandoned. No database ever ran them"; ADR-0005 reserved that range |
| **Decision** | D-007, D-013 |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** A brand-new database could not be set up: the migration run stopped half-way.
- **Why:** Two abandoned migrations were left in: 0054 builds a view on a table that never existed, 0055 inserts into columns that don't exist.
- **What it breaks:** No new environment (laptop, CI, Dilmune Cloud) could be created.

## 1. The issue

`docker compose -f ops/docker-compose.yml run --rm migrate` on an empty database stops at
`0054_views.sql`. Once that is fixed it stops again at `0055_chart_of_accounts_suspense.sql`.
No new environment (including Dilmune Cloud) can be created.

## 2. Why it happened

`db/migrate.ts` applies every file in order, each in a transaction, and stops at the first error.
Two abandoned PRs were left in the folder:

- **0054** creates `v_unbatched_capture_events`, which reads `settlement_batch_events`. **No migration creates that table.**
- **0055** runs `INSERT INTO chart_of_accounts (code, name, account_type, description)` with type `'suspense'`.
  0007 defines the table as `(id, name, kind)` with `CHECK (kind IN ('asset','liability','revenue'))`.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| FilsPay engineering / ops | No fresh DB: no local runs, no CI database, no new deploy | Total block |
| Merchants | No fix or new feature can ship | Indirect |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0054_views.sql` | Removed only `v_unbatched_capture_events` (nothing queries it), with a comment. `merchant_payable_position` and `v_active_api_keys` stay. |
| `db/migrations/0055_chart_of_accounts_suspense.sql` | Body replaced by a commented `SELECT 1` no-op. `fx_rounding_difference` / `chargeback_suspense` are referenced nowhere; scheme rounding already uses `scheme_rounding_residue`. |

Minimal: the file numbers stay taken, and databases that already recorded these files are
unaffected (the runner tracks only filenames; there is no checksum, despite MK's comment).

Note: `merchant_payable_position` is the wrong source used by the "rebuild balances" button.
That is a separate bug (B1 / BUG-017), not part of this fix.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Neutralise the broken parts in place | Fresh migrate works; numbers kept; nothing invented | Edits files that were never applied anywhere (allowed by D-007) | ✅ |
| 2 | New 0073 creating `settlement_batch_events` | 0054 unchanged | Useless: 0054 fails before 0073 runs; invents a table nothing writes | |
| 3 | Delete or renumber 0054/0055 | Clean folder | Breaks staging-2 if it recorded them; ADR-0005 range | |
| 4 | Rewrite 0055 with real columns | Keeps the accounts | `'suspense'` still fails the CHECK; unused accounts | |

## 6. Proof

| Check | Before | After |
|---|---|---|
| `… run --rm migrate` on an empty DB | ❌ `failed applying 0054_views.sql` → then `0055 … column "code" … does not exist` | ✅ `66 migration(s) applied` |
| `… run --rm seed` | — | ✅ `all REAL assertions passed` |

Existing tests changed: none.
