# Bug write-ups — how the two numbering schemes fit together

Ebrahim and Sayed fixed bugs in parallel and numbered some of them differently. **The ID used in
`docs/FINDINGS-REPORT.md` and `docs/challenge/PLAN.md` is the team ID** (left column). Where Sayed's
write-up uses another number, this table maps it. Both write-ups are kept: they show two independent
fixes and tests for the same problem, and the merged code keeps one implementation (noted below).

| Team ID | Problem | Ebrahim's write-up | Sayed's write-up | Code kept in the merge |
|---|---|---|---|---|
| BUG-001, 002, 003, 010, 011, 012, 013, 031, 032 | Login, OTP, access (same numbers) | `BUG-0xx-*.md` | `BUG-0xx-*.md` (second file with the same number) | Ebrahim's (tested together with the rest of the branch); Sayed's tests kept and passing |
| BUG-033 | Support admin could issue credits | `BUG-033-admin-route-role-audit.md` | `BUG-035-support-admin-can-issue-credits.md` | Ebrahim's |
| SEC-RT-5 | Report reads another shop's split child | `SEC-RT-5-report-reads-other-shops-split-child.md` | `BUG-034-report-other-merchants-split-child.md` | Same SQL on both sides |
| BUG-052 | Capture fee ignored the negotiated discount | — | `BUG-036-capture-fee-ignores-discount.md` | Sayed's |
| BUG-055 (part) | Dead UTC-dated capture metric | — | `BUG-037-capture-metric-utc-date.md` | Sayed's |
| CAP-3 | Full table scans on every capture | `CAP-3-ledger-seq-scans.md` | `BUG-038-checkout-full-table-scans.md` | Both migrations, now idempotent (`IF NOT EXISTS`) |
| BUG-051 | Scheme rounding residue never journaled | — | `BUG-041-scheme-residue-not-journaled.md` | Sayed's |
| BUG-024, BUG-028, BUG-054 | Settlement summary, lifetime estimate, reconciliation rate (same numbers) | — | `BUG-024/028/054-*.md` | Sayed's |
| W-poison (new) | Undecryptable webhook secret blocked every merchant's webhooks | — | `BUG-053-webhook-undecryptable-secret-stuck.md` | Sayed's error handling + Ebrahim's signing (BUG-023) |
| S-033 (new) | Bulk KYC approved rejected merchants | — | `BUG-033-bulk-kyc-approves-rejected-merchants.md` | Sayed's |
| BUG-036 | Refund another shop's transaction | `BUG-036-refund-other-merchant.md` | — | Ebrahim's |

Sayed's full list: `SAYED-BUGS.md` (repo root).
