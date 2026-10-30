# BUG-084 — Credit form defaults to the browser's day, not Bahrain's

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Money · Settlement (staff console) |
| **Analysis ID** | — (found in the frontend bug hunt) |
| **Clue** | comment "browser local date not bahrain, fine for bahrain staff — am" |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-084` |
| **Owner** | Sayed |
| **Evidence** | unit test |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** "Issue credit" pre-fills the effective date with the computer's own date, which is not the Bahrain business day when the browser is in another time zone.
- **Why:** `todayIso()` used `getFullYear/getMonth/getDate`, which are the browser's local calendar.
- **What it breaks:** a credit gets booked on yesterday's (or tomorrow's) Bahrain business day, so it lands in the wrong settlement batch.

## 1. The issue — what was wrong

The server books both ledger legs of a credit at Asia/Bahrain midnight of its effective date
(`apps/api/src/admin/credits.ts:149`). The form's default date came from the browser's clock.
A staff laptop on UTC (cloud desktop, travelling, remote support) at 00:30 Bahrain time
(21:30 UTC) shows **yesterday**; a laptop east of Bahrain (e.g. UTC+4 after 20:00 UTC) shows
**tomorrow**. The operator usually keeps the default, so the credit is booked on the wrong day.

Reproduce: run the console with `TZ=UTC`, open a merchant at 21:30 UTC → the date field shows
the UTC day, one day behind Bahrain.

## 2. Why it happened — the root cause

Present in the original code: `apps/admin/src/pages/merchants/MerchantDetailPage.tsx:19` at 8b58b0f (`todayIso()` built from `getFullYear/getMonth/getDate`).

`apps/admin/src/pages/merchants/MerchantDetailPage.tsx:16` (before):

```ts
// browser local date not bahrain, fine for bahrain staff — am
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${...now.getMonth() + 1...}-${...now.getDate()...}`;
}
```

The comment is the trap: "fine for Bahrain staff" is only true when the browser itself is set to
Bahrain time. Business day rule: midnight Asia/Bahrain = 21:00 UTC.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | — | — |
| Merchants | credit paid in a different batch than expected, or after a batch already closed | Medium |
| FilsPay (finance / ops) | credit dated on the wrong business day; reconciliation by day is off | Medium |
| Acquirer / card scheme / partners | — | — |

## 4. The fix

| File | Change |
|---|---|
| `apps/admin/src/format.ts` | new `bahrainToday(now)` using `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bahrain" })` |
| `apps/admin/src/pages/merchants/MerchantDetailPage.tsx` | default effective date is `bahrainToday`; old helper removed |

```ts
export function bahrainToday(now: Date = new Date()): string {
  return BAHRAIN_YMD.format(now); // "2026-10-30"
}
```

Same approach `format.ts` already uses for every displayed date (Asia/Bahrain via Intl).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Bahrain day via `Intl` with `timeZone: "Asia/Bahrain"` | one line, matches the rest of format.ts | — | ✅ |
| 2 | Add 3 h to UTC and slice | no Intl | hand-rolled offset; breaks if rules ever change | |
| 3 | No default, force the operator to pick | no wrong default | slower, and the operator can still pick the wrong day | |

**Why we chose #1:** correct in every browser zone with the smallest change.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| 00:30 Bahrain is the new day | `apps/admin/src/format.new.test.ts` | ❌ (TZ=America/New_York) gives 2026-10-29 | ✅ 2026-10-30 |
| 21:00 UTC flips the day | same | ❌ | ✅ |

```bash
TZ=America/New_York npm test -w apps/admin
```

Existing tests changed: none.
