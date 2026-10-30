# ENH-009 — Limits and secret handling for the dashboard AI assistant

| | |
|---|---|
| **Type** | Enhancement (hardening of Sayed's assistant feature) |
| **Area** | Security · Cost · Availability |
| **Approved by** | Ebrahim, 2026-10-30 ("make sure it's secure: rate limit, token max and all of that") |
| **Status** | ✅ done |

## Summary

- **What it adds:** a per-merchant budget for the paid AI calls (6 a minute, 100 a day by default), on top of the limits the assistant already had.
- **Why it's worth it:** without it any logged-in shop, or a script with an API key, could send thousands of questions and run up the AI bill (a cost / denial-of-wallet attack).
- **Cost / risk:** one small table; a shop asking more than 6 questions a minute waits a few seconds.

## Controls on the assistant (all of them)

| Control | Value | Where |
|---|---|---|
| Login required | merchant session or API key | `routes/assistant.ts` (`requireMerchantAuth`) |
| Read-only view-as-shop can't chat | POST refused for impersonation | BUG-010 |
| Sees only the caller's own data | every tool is scoped to the session merchant | `assistant/tools.ts` |
| **Calls per merchant** | **6 / minute, 100 / day** → `429 assistant_rate_limited` + `Retry-After` | `assistant/usageLimit.ts` (new) |
| Reply size | `ASSISTANT_MAX_TOKENS=1024` (payout explanation ≤ 512) | config |
| Input size | `ASSISTANT_MAX_MESSAGE_CHARS=2000`, `ASSISTANT_MAX_HISTORY=12` | config |
| Data lookups per question | `ASSISTANT_MAX_TOOL_ROUNDS=3` | config |
| Effort | `low` | config |
| Payout explanations cached | the same payout is explained once | `routes/assistant.ts` |
| No key = off | `503 assistant_not_configured` | config |
| **The key** | only in the git-ignored `ops/.env.docker` (laptop) and `ops/.env.prod` (server), file mode 600; never in git, never logged | — |

The budget is kept in Postgres (`assistant_usage`, migration 0080) under a per-merchant advisory lock,
so parallel requests can't slip past it and several API instances share one budget. Only calls that
reach the AI service count (a cached payout explanation is free).

## Proof

| Test | Result |
|---|---|
| 7th call in a minute → 429 with Retry-After; another shop unaffected | ✅ |
| 12 parallel calls → exactly 6 allowed | ✅ |
| Daily budget holds even when each minute is under its limit | ✅ |
| Chat route refuses **before** calling the AI service when the budget is spent | ✅ |
| API suite | 554 / 554 |
| Real run (local, real key): a shop asked a question | 200, the assistant looked up the shop's own transactions and answered |

**Note:** the key was shared in a chat on 2026-10-30; rotate it after the event (console → API keys).
