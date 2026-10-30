# BUG-090 — Staff "Adjust balance" reads "50.000" as 50 fils

| | |
|---|---|
| **Severity** | High |
| **Area** | Money (staff console) |
| **Analysis ID** | — (found in the frontend bug hunt) |
| **Clue** | `Number(...)` on typed money text in `apps/admin` |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-090` |
| **Owner** | Sayed |
| **Evidence** | unit test |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** a finance admin who types `50.000` into "Adjust balance" moves the merchant's balance by 0.050 BD, not 50 BD.
- **Why:** the page turns the text into a number with `Number()`, which reads `"50.000"` as 50, `"1e3"` as 1000 and `"0x10"` as 16.
- **What it breaks:** a balance correction can be 1000 times too small (or a different number) with no warning.

## 1. The issue — what was wrong

Merchant detail → "Adjust balance". The field is in fils, but every other amount in the console
(and the "Issue credit" box right below it) is typed in BD with three decimals. Typing `50.000`
passed the check and posted a correction of **50 fils**. `1e3` posted 1000 fils, `0x10` posted 16.

## 2. Why it happened — the root cause

Present in the original code: `apps/admin/src/pages/merchants/MerchantDetailPage.tsx:118` at 8b58b0f (`Number(adjustDeltaFils.trim())`).

`apps/admin/src/pages/merchants/MerchantDetailPage.tsx:116` (before):

```ts
const deltaFils = Number(adjustDeltaFils.trim());
if (!Number.isInteger(deltaFils) || deltaFils === 0) {
```

`Number("50.000")` is `50`, an integer, so the guard let it through. The server only checks
"is an integer", so it cannot tell either.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | — | — |
| Merchants | balance corrected by the wrong amount | High: payout wrong until someone notices |
| FilsPay (finance / ops) | correction in the audit log does not match what the operator meant | Medium |
| Acquirer / card scheme / partners | — | — |

## 4. The fix

| File | Change |
|---|---|
| `apps/admin/src/filsInput.ts` | new pure `parseWholeFils`: digits only (optional sign), safe integer, non-zero |
| `apps/admin/src/pages/merchants/MerchantDetailPage.tsx` | uses it; the error says "digits only (50000 fils = 50.000 BD)" |
| `apps/admin/package.json`, `tsconfig.json` | `test` script and `node` types so the admin app can run node:test files |

```ts
const trimmed = text.trim();
if (!/^[+-]?\d+$/.test(trimmed)) return null;
const fils = Number(trimmed);
return Number.isSafeInteger(fils) && fils !== 0 ? fils : null;
```

Smallest change: the field and the API stay in fils; only the text check becomes strict, so a
BD-looking value is refused instead of silently changed.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Strict digits-only fils parse | tiny, no API change | operator still types fils | ✅ |
| 2 | Switch the field to BD and use `parseBhdToFils` | matches the credit box | changes the form and its label; bigger change | |
| 3 | Server-side check only | — | the server cannot tell 50 from "50.000" | |

**Why we chose #1:** it stops the wrong amount with the least change.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| BD-style text is refused | `apps/admin/src/filsInput.new.test.ts` | ❌ `"50.000"` → 50 | ✅ null |
| exponent/hex refused | same | ❌ `"1e3"` → 1000 | ✅ null |
| past safe range refused | same | ❌ → 9007199254740992 | ✅ null |

```bash
npm test -w apps/admin
```

Existing tests changed: none.
