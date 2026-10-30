# FP-300.1 — Refund route: `POST /v1/merchants/:merchantId/refunds`

| | |
|---|---|
| **Severity** | Feature (missing) · ★★★ |
| **Area** | Refunds (FP-300) · API · Security |
| **Analysis ID** | R1–R3 context, Q-1 |
| **Clue** | S2 FP-300 sheet: "works end to end through the API" |
| **Owner** | Stream S6 |
| **Status** | ✅ done |

## Summary (the short note)

- **What was missing:** There was no way to refund. `POST /v1/refunds` always answered `501 not_implemented`, and the web drawer called a different path that did not exist.
- **Why:** The refund helpers were "done" but never wired. Two paths were argued about in comments (`/v1/refunds` vs `/v1/merchants/:id/refunds`) and nobody picked one.
- **What we did:** Wired the path the web app already calls (decision **Q-1**), behind the same guards as payment links, with a **required** `Idempotency-Key`.

## 1. Decision Q-1 — which path

| Fact | Where |
|---|---|
| The web `RefundDrawer` posts to `/v1/merchants/${merchantId}/refunds` | `apps/web/src/pages/transactions/RefundDrawer.tsx` |
| `initiateMerchantRefund` is documented as `POST /v1/merchants/:merchantId/refunds` and ships `assertRefundRequestScope(auth, merchantIdParam)` for that path | `apps/api/src/refunds/initiateMerchantRefund.ts` |
| Payment links and webhooks use the same `/v1/merchants/:merchantId/...` shape | `routes/paymentLinks.ts`, `routes/webhooks.ts` |
| `/v1/refunds` was only ever a 501 stub | `routes/refunds.ts` (before) |

So the merchant-scoped path wins; the stub is removed (old path now 404).

## 4. The change

| File | Change |
|---|---|
| `apps/api/src/routes/refunds.ts` | real handler: `requireMerchantAuth` → `requireMerchantRole("owner","finance")` → path merchant must equal the caller (`assertRefundRequestScope`, 403) → admin "view as" grants refused (read-only) → `Idempotency-Key` required (400 `idempotency_key_required`) → body checks (`transactionId` UUID, `amountFils` positive whole fils, `reason` ≤ 500 chars) → `initiateMerchantRefund` |
| `apps/api/src/app.ts` | `refundRoutes` registered under `/v1/merchants` instead of `/v1/refunds` |
| `apps/api/src/routes/refunds.test.ts` | 7 new route tests (below) |
| `apps/api/src/routes/transactions.test.ts` | removed the "returns 501" test: it encoded the missing feature (its own comment said "delete/replace this when FP-212 lands") |

Notes: the client's key is used as-is (the AI-drafted handler in the old comment used `crypto.randomUUID()` per request,
which would make every retry a new refund). Money is integer fils; `1.5` or `"100"` is a 400, not a rounded refund.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | `/v1/merchants/:merchantId/refunds`, required client key | Matches web app and helper; same guards as other merchant writes; retries are safe | Old `/v1/refunds` doc line must change | ✅ |
| 2 | Keep `/v1/refunds`, change the web drawer | Matches one line of API.md | Two places to change; loses the path-scope check the helper was built for | |
| 3 | Register both paths | Nobody breaks | Two surfaces to secure and test for one action | |
| 4 (creative) | Refund as a sub-resource `POST /v1/transactions/:id/refunds` | Reads naturally next to capture/void | Nothing calls it; bigger change to client and helper | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| owner session refunds part of its own transaction (reason stored, actor = session) | `apps/api/src/routes/refunds.test.ts` | ❌ 404 | ✅ |
| finance may refund, support gets 403 | same | ❌ 404 | ✅ |
| API key can refund; no `Idempotency-Key` → 400 | same | ❌ 404 | ✅ |
| same key twice → same body, one refund | same | ❌ 404 | ✅ |
| other merchant's path → 403, other merchant's transaction → 404 | same | ❌ 404 | ✅ |
| bad amounts / missing id → 400, non-UUID → 404, over-refund → 422, never 500 | same | ❌ 404 | ✅ |
| unauthenticated → 401; old `/v1/refunds` → 404 | same | ❌ 404 | ✅ |
| `transactions.test.ts` (9 tests) | | ✅ | ✅ |

Follow-ups (not in this change): the web drawer (F1) still makes a new key per click and hides itself on
`partially_refunded`; `docs/API.md` should list only the new path.
