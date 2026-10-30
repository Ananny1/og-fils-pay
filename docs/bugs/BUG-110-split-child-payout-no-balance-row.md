# BUG-110 — Payout skipped in the balance cache when the shop has no balance row

Listed in the audit as **BUG-053** (PLAN 4.15, ANALYSIS S12). Sayed's branch used BUG-053 for a
different fix (webhook secret), so this one takes the next free number.

**Summary:** a payout for a shop with no `merchant_balances` row (a split child) changed nothing,
so the payout never left the cached balance.

## The issue
`apps/settlement/internal/balances/cache.go` `ApplyPayout` ran `UPDATE merchant_balances ... WHERE
merchant_id = $1`. With no row, 0 rows change and no error is raised.

## Why
`ApplyBatchClose` upserts, `ApplyPayout` only updated. Split children never go through a batch
close of their own, so they often have no row.

## Who was affected
Marketplace sellers (split children): their cached payable balance was wrong until a full rebuild.
The ledger itself was correct.

## The fix
`ApplyPayout` now upserts with the same signed-delta idiom as `ApplyBatchClose`.

## Options ranked
1. **Upsert (chosen):** one statement, same idiom as the close path.
2. Return an error on 0 rows: would block real payouts.
3. Create rows for every child up front: more code paths, still racy.

## Proof
`internal/balances/cache_test.go` `TestApplyPayout_NoBalanceRow`: fails on the old code (no row),
passes now (`-2000` after two payouts). Go suite: all packages ok.
