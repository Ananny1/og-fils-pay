# BUG-NNN — <short title>

| | |
|---|---|
| **Severity** | Critical / High / Medium / Low |
| **Area** | Security · Money · Settlement · Webhooks · Reporting · Deploy |
| **Analysis ID** | e.g. A1 (see `docs/challenge/ANALYSIS.md`) |
| **Clue** | Handout sheet / ticket / incident that pointed here |
| **Decision** | D-xxx in `IMPLEMENTATION.md` |
| **Commit** | `<hash>` |
| **Status** | ⬜ planned · ⏳ in progress · ✅ fixed |

## 1. The issue — what was wrong

What a user, merchant or finance person would see. One short paragraph. Include how to reproduce it.

## 2. Why it happened — the root cause

The exact code (`file:line`) and why that logic fails. Quote the bad lines.

```ts
// before
```

Which trap or false claim kept it hidden, if any (`TRAPS.md` T-xx).

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | | |
| Merchants | | |
| FilsPay (finance / ops) | | |
| Acquirer / card scheme / partners | | |

## 4. The fix

| File | Change |
|---|---|
| `path/to/file.ts:NN` | what changed |

```ts
// after
```

Why this is the **smallest correct** change, and why it removes the root cause, not just the symptom.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | | | | ✅ |
| 2 | | | | |
| 3 | | | | |

**Why we chose #1:** one or two sentences.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `name of test` | `path/to/foo.test.ts` | ❌ fails (why) | ✅ passes |

```bash
# command to run it
```

Existing tests changed (and why): none / list.
