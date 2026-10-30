# BUG-025 — Large export loaded everything in memory; the streaming version skipped rows

**Summary:** `GET /v1/transactions/export` built the whole CSV as one string (a big shop could
exhaust the 512 MB container), and the "streaming" version the CHANGELOG mentions lost rows that
share a timestamp at a page edge.

## The issue
- `routes/transactions.ts` called `buildTransactionsExportCsv` (every row in memory).
- `streamTransactionsExportCsv` paged with `occurred_at > cursor`, so rows with the same
  `occurred_at` as the last row of a page were skipped.

## Why
Keyset paging on a non-unique column, and the route never switched to the streaming function.

## Who was affected
Shops exporting a large history (memory spike for everyone on the box) and anyone whose export
crossed a page edge with equal timestamps (missing rows in their books).

## The fix
- Keyset on `(occurred_at, id)` with `ORDER BY occurred_at, id`.
- The route streams page by page through a `PassThrough`, waits for the socket to drain, and stops
  when the client disconnects. Memory stays at one page (1000 rows).

## Options ranked
1. **Stream with a (occurred_at, id) keyset (chosen):** bounded memory, no lost rows.
2. Keep the in-memory builder with a row cap: still large, and truncates exports.
3. Background export job to a file: more moving parts than this fix needs.

## Proof
`exportCsv.test.ts` "BUG-025: streaming export keeps rows that share a timestamp across page
edges": 5 rows at one timestamp, page size 2 → all 5 exported (the old keyset returns 2).
API suite: 651/651.
