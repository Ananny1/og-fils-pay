# BUG-014 — CSV adjustment import is 10× off

| | |
|---|---|
| **Severity** | Critical |
| **Area** | Money |
| **Analysis ID** | B2 (see `docs/challenge/ANALYSIS.md`) |
| **Clue** | Finance: "4.75 BD correction posted as 0.475 BD" |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** finance uploads a CSV with `4.75`. The system posts **475 fils (0.475 BD)** instead of **4750 fils (4.750 BD)**. `4.755` becomes `4.750` (the last digit is cut off).
- **Why:** the importer used a helper that reads money as **2 decimals (cents)** and **truncates** extra digits. Bahraini Dinar has **3 decimals** (1 BD = 1000 fils).
- **What it breaks:** every CSV correction is 10× too small and loses fils. Merchant balances and the ledger are wrong after every import.

## 1. The issue

`POST /v1/admin/adjustment-imports` with a row `…,4.75,correction` posted 475 fils. A row `4.755` posted 4750 (should be 4755). No error is shown, so finance doesn't notice.

## 2. Why it happened — the root cause

`apps/api/src/admin/adjustmentCsvParsing.ts` called `parseDecimalMinor(raw)` whose default is `decimals = 2`:

```ts
return toFils(parseDecimalMinor(raw), { allowNegative: true });
// parseDecimalMinor: fracPart.padEnd(decimals, "0").slice(0, decimals)  -> 2 digits, truncated
```

ADR-0001 rule 3 says text amounts must be parsed with `parseBhdToFils`.

False claims that hid it (traps):
- `routes/adminAdjustmentImport.ts:58` — "parseAdjustmentCsv handles 3dp BD amounts correctly (4.750 -> 4750 fils), Claude checked". **False**: `4.750` became 475.
- `routes/adminAdjustmentImport.test.ts:236-238` — "4.75 -> 475 … the import format is 2dp by agreement with finance". **False**: no such agreement; ADR-0001 says 3 decimals.
- `admin/adjustmentImport.test.ts` asserted `parsedAmountFils === 475` (the test encoded the bug).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Corrections credited/debited at 1/10 of the right amount | High: wrong payouts |
| FilsPay finance | Ledger and cached balances wrong after every import; truncation loses fils | High |
| Customers | Not directly | — |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/admin/adjustmentCsvParsing.ts` | Use `parseBhdToFils(raw)` instead of `toFils(parseDecimalMinor(raw))`. More than 3 decimals is now rejected (400 `invalid_amount`) instead of silently cut. |
| `apps/api/src/routes/adminAdjustmentImport.ts` | Replaced the false "Claude checked" comment with a correct one. |

```ts
return parseBhdToFils(raw);
```

Smallest correct change: one line, using the platform's own parser. It fixes the root cause (wrong number of decimals and truncation), not just the one example.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Call `parseBhdToFils` (ADR-0001 rule 3) | One line; same rules as every other money input; rejects >3 dp | Old 2dp files now import at the correct (bigger) value — that is the point | ✅ |
| 2 | Call `parseDecimalMinor(raw, 3)` | Also one line | Still truncates a 4th digit silently; a second parser to keep in sync | |
| 3 | Show a "preview" step with the parsed fils before applying (creative) | Humans would catch a 10× error | Bigger change, needs UI; doesn't fix the parser | |
| 4 | Ask finance to upload fils (integers) | No decimals at all | Changes the agreed file format; error-prone for humans | |

**Why we chose #1:** it uses the one approved parser and removes the bug class (wrong decimals + silent truncation).

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-014: amounts are parsed as BD with 3 decimals into fils` | `apps/api/src/admin/adjustmentCsvParsing.test.ts` | ❌ 475 ≠ 4750 | ✅ |
| `BUG-014: more than 3 decimals is rejected` | same | ❌ `4.7551` accepted as 475 | ✅ |
| importer + route tests (31 total) | `admin/adjustmentImport.test.ts`, `routes/adminAdjustmentImport.test.ts` | — | ✅ |

```bash
npx tsx --test apps/api/src/admin/adjustmentCsvParsing.test.ts apps/api/src/admin/adjustmentImport.test.ts apps/api/src/routes/adminAdjustmentImport.test.ts
```

Existing tests changed (and why): they asserted the 2-decimal bug. `admin/adjustmentImport.test.ts`: 475→4750, 125→1250, total 600→6000, legs 350→3500, cache 500→5000. `routes/adminAdjustmentImport.test.ts`: total 600→6000 and removed the false "2dp by agreement" comment.
