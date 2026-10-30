# SEC-RT-3: `GET /v1/reporting/export-summary` has no login check

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Security (access control) |
| **Analysis ID** | Security sprint, red-team finding SEC-RT-3 (lens: input) |
| **Clue** | Unauthenticated `curl .../v1/reporting/export-summary` returns 500 `internal_error` |
| **Decision** | D-016 (security sprint) |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** One reporting route has no login guard. Anyone can call it, and it crashes with a 500.
- **Why:** Every other route in `routes/reporting.ts` has `{ preHandler: requireMerchantAuth }`. `/export-summary` was added without it, but its handler still reads `request.merchantAuth!.merchantId`.
- **What it breaks:** The access control is simply missing. Today the null `merchantAuth` crashes before the query, so no data leaks, but any future change to the handler (e.g. a default merchant id) would leak totals. It is also a free, reliable 500 for anyone scanning the API, and real merchants get a 500 instead of their summary.

## 1. The issue

To reproduce: `curl -i http://<api>/v1/reporting/export-summary` with no cookie and no bearer.
Before the fix: HTTP 500. With a valid API key it was also 500, because `merchantAuth` was never set.

## 2. Why it happened

`apps/api/src/routes/reporting.ts` registered `app.get("/export-summary", async (request) => ...)`
with no options object, so `requireMerchantAuth` never ran. The `!` on `request.merchantAuth!`
hid the gap from the type checker.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Their summary endpoint never worked (always 500) | Low |
| FilsPay staff / ops | An unauthenticated endpoint that always errors (noise, easy probe) | Medium |
| Customers | None today | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/reporting.ts` | `/export-summary` gets `{ preHandler: requireMerchantAuth }`, like its siblings |
| `apps/api/src/routes/reporting.exportSummary.test.ts` | New: no credentials gives 401; with an API key only the caller's own totals come back |

No new query, index or state.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Add `requireMerchantAuth` to the route | One line, same as every sibling route | None | ✅ |
| 2 | Register a plugin-level `onRequest` hook for the whole `/v1/reporting` prefix | A future route can't forget it | Bigger change; double-runs the guard on existing routes | Later |
| 3 | Check `request.merchantAuth` inside the handler and throw 401 | Works | Duplicates the guard logic; the next route could forget it too | |
| 4 | Delete the route | Removes the surface | It is a real merchant feature | |

## 6. Proof: tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `export-summary without credentials is 401, not a 500` | `apps/api/src/routes/reporting.exportSummary.test.ts` | ❌ 500 | ✅ 401 |
| `export-summary with credentials returns only the caller's own totals` | same | ❌ 500 | ✅ 200, `{ totalDays: 2, grossFils: 4000 }` (other merchant's 99000 not included) |
| `tsc --noEmit -p apps/api` | | ✅ | ✅ |
