# BUG-085 — Webhook replay window is read in the browser's time zone

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Webhooks (staff console) |
| **Analysis ID** | — (found in the frontend bug hunt) |
| **Clue** | comment "default window is local time — am" |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-085` |
| **Owner** | Sayed |
| **Evidence** | unit test |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** the From/To boxes on "Webhook replay" use the computer's own time zone, while every delivery time in the console is shown in Bahrain time.
- **Why:** the page converted the `datetime-local` value with `new Date(value)`, which reads it in the browser's zone.
- **What it breaks:** on a browser that is not on Bahrain time, the replay covers the wrong hours: it misses failed deliveries the operator meant to resend, or resends ones they did not mean to.

## 1. The issue — what was wrong

An operator sees exhausted deliveries at "30 Oct 2026, 18:00" (Bahrain time, UX-21) and types
18:00–19:00 into the replay form. On a laptop set to UTC that window is sent as 18:00–19:00
**UTC** = 21:00–22:00 Bahrain, three hours off. The deliveries they wanted are not replayed;
others are. An empty or half-filled box also crashed the click (`new Date("").toISOString()`
throws outside the `try`).

## 2. Why it happened — the root cause

Present in the original code: `apps/admin/src/pages/webhooks/WebhookReplayPage.tsx:24` and `:103` at 8b58b0f.

`apps/admin/src/pages/webhooks/WebhookReplayPage.tsx:24` and `:104` (before):

```ts
function toLocalInputValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;      // browser zone
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
...
from: new Date(range.from).toISOString(),                  // browser zone
to: new Date(range.to).toISOString(),
```

The merchant dashboard already reads these inputs as Bahrain time
(`apps/web/src/format.ts` `localDateTimeToIso`); the console did not.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | — | — |
| Merchants | missed events stay undelivered (order not marked paid), or get events again | Medium |
| FilsPay (finance / ops) | operator thinks a replay covered the incident when it did not | Medium |
| Acquirer / card scheme / partners | — | — |

## 4. The fix

| File | Change |
|---|---|
| `apps/admin/src/format.ts` | `bahrainInputValue(date)` and `bahrainInputToIso(value)` (UTC+3, no DST) |
| `apps/admin/src/pages/webhooks/WebhookReplayPage.tsx` | default window and submit use them; labels say "(Bahrain time)"; an invalid box shows an error instead of throwing |

```ts
const parsed = new Date(`${withSeconds}+03:00`);
```

Same rule the web app uses, so both consoles mean the same instant by the same text.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Read/write the inputs as Bahrain time | matches every displayed time | — | ✅ |
| 2 | Keep browser zone, show times in browser zone on this page | no conversion | the page disagrees with the rest of the console | |
| 3 | Send the raw text and let the API pick the zone | one place | API change; other callers send ISO instants | |

**Why we chose #1:** the console shows Bahrain time everywhere, so input must mean Bahrain time too.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| typed replay time is Bahrain time | `apps/admin/src/format.new.test.ts` | ❌ (TZ=America/New_York) 18:00 → 22:00Z | ✅ 15:00Z |
| default window in Bahrain wall time | same | ❌ | ✅ |

```bash
TZ=America/New_York npm test -w apps/admin
```

Existing tests changed: none.
