# BUG-030 — CSV export formula injection

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Security · Reporting |
| **Analysis ID** | Q4 |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** the transactions CSV export writes the `reference` text exactly as stored. A reference like `=HYPERLINK("http://evil.test","Click")` becomes a live formula when the merchant opens the file in Excel, Google Sheets or LibreOffice.
- **Why:** `csvEscape` only handles commas, quotes and new lines. It never checks for the characters that start a formula (`=`, `+`, `-`, `@`, TAB, CR).
- **What it breaks:** whoever controls a reference (an API integration, a payment-link payer, a compromised partner) can make the merchant's finance staff click a phishing link or leak data from the sheet (`=WEBSERVICE(...)`, DDE on old Excel).

## 1. The issue

Create a transaction with reference `=1+1`, export `GET /v1/transactions/export`, open it in a spreadsheet: the cell shows `2`, not `=1+1`. The code has a hint: `// no test for a reference starting with "=" — am`.

## 2. Why it happened — the root cause

`apps/api/src/transactions/exportCsv.ts` `csvEscape` (before):

```ts
if (value.includes(",") || value.includes('"') || value.includes("\n")) {
  return `"${value.replace(/"/g, '""')}"`;
}
return value;
```

No formula guard. A lone `\r` was not quoted either, so it could break the row in some readers.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants (finance staff) | Open the export, formulas run / phishing links appear | Medium |
| Customers | Could be the attacker if they control a reference | — |
| FilsPay | Security finding against our export | Medium |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/transactions/exportCsv.ts` `csvEscape` | If the value starts with `= + - @ TAB CR`, prefix a single quote `'` (OWASP advice); also quote a field that contains `\r`. Used by both `buildTransactionsExportCsv` and `streamTransactionsExportCsv`. |

```ts
if (/^[=+\-@\t\r]/.test(value)) {
  value = `'${value}`;
}
if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) { ... }
```

Only the `reference` column is free text; the other columns are ids, enum statuses, formatted fils (`12.500`, never negative) and ISO dates, so they cannot start with a trigger.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Prefix `'` on cells starting with `= + - @ TAB CR` (OWASP) | Tiny; standard; works in Excel/Sheets/LibreOffice | A legit reference like `-123` shows as `'-123` in a raw text viewer | ✅ |
| 2 | Strip the trigger characters | Clean output | Changes the data; two different references can collide | |
| 3 | Reject such references at input (authorize / payment links) | Stops it at the source | Breaks partner integrations; old rows still exported raw | |
| 4 (creative) | Offer an `.xlsx` export with every cell typed as text | No formula parsing at all | New dependency and endpoint; too big for the sprint | |

**Why we chose #1:** it is the industry-standard defence, a few lines in one function, and it does not change the stored data.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `a reference that looks like a spreadsheet formula is neutralised with a leading quote` (new) | `apps/api/src/transactions/exportCsv.test.ts` | ❌ fails (raw `=HYPERLINK(...)` in output) | ✅ |
| `a plain reference is not changed by the formula guard` (new) | same | ✅ | ✅ |
| Existing 5 export tests | same | ✅ | ✅ |

Existing tests changed (and why): none.
