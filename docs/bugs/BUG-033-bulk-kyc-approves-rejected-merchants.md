# BUG-033 — Bulk KYC approve also approves rejected merchants and merchants with no KYC

| | |
|---|---|
| **Severity** | High |
| **Area** | Security (authorisation of merchants) |
| **Analysis ID** | — (new) |
| **Clue** | `BulkApproveMerchantsKycResult` JSDoc and ADMIN.md: "Only merchants currently under_review are affected"; YA's note in `onboarding/review.ts` ("bulk should reuse this") |
| **Decision** | — |
| **Commit** | see `git log --grep "BUG-033"` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

**Bulk approve** in the admin console set `approved` + `kyc_passed = true` on
**every** merchant id sent, whatever its state:

- a merchant whose KYC was **rejected** (for example, failed AML checks)
  became approved and could take card payments;
- a merchant that had **never uploaded** documents (`submitted`) was approved.

It also wrote no `merchant_kyc_reviews` row, so the merchant's KYC history
showed no review at all for the approval.

Reproduce: put one `rejected` merchant id in `POST /v1/admin/merchants/bulk-approve`
→ it comes back in `approvedMerchantIds` and is now `approved`.

## 2. Why it happened — the root cause

`apps/api/src/admin/bulkKyc.ts`:

```ts
// before
UPDATE merchants
   SET onboarding_status = 'approved', kyc_passed = true
 WHERE id = ANY($1::uuid[])
```

No status predicate, although the result type's doc, the route comment and
ADMIN.md all say only `under_review` merchants are affected. The single
review path (`recordKycReviewInTx`) writes a `merchant_kyc_reviews` row; bulk
skipped it. MK's "bulk writes the review trail too (kyc_bulk_approve audit
row)" is false: the audit log row is not the merchant's review trail. The
`admin.test.ts` comment "per-merchant merchant_kyc_reviews rows are written as
well" was also false.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | Could pay merchants that failed KYC | High |
| Merchants | — | — |
| FilsPay (finance / ops) | Onboarding controls (KYC/AML) bypassed by one click; no review record | High |
| Acquirer / card scheme / partners | Scheme rules require KYC before processing | High |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/admin/bulkKyc.ts` | `AND onboarding_status = 'under_review'` on the UPDATE |
| `apps/api/src/admin/bulkKyc.ts` | insert one `merchant_kyc_reviews` row (outcome `approved`, reviewer = the admin's email and id, notes) per approved merchant, in the same transaction |

```sql
-- after
UPDATE merchants SET onboarding_status = 'approved', kyc_passed = true
 WHERE id = ANY($1::uuid[]) AND onboarding_status = 'under_review'
RETURNING id
```

`approvedMerchantIds` stays the authoritative list of what moved (the
response and audit row already used it). Everything stays in the one
transaction with the audit row, so a failed audit still rolls everything back.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Status predicate + bulk review rows in the same tx | Smallest; matches the documented contract | — | ✅ |
| 2 | Loop `recordKycReviewInTx` per id after checking status | Reuses the single path | N statements; that function does not check status either | |
| 3 | Reject the whole request if any id is not under_review | Strict | Worse UX for a queue tool; the API already reports what moved | |

**Why we chose #1:** keeps the bulk behaviour (skip what doesn't qualify) but makes it true.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-033: bulk approve only approves under_review merchants and writes a review row for each` | `apps/api/src/admin/bulkKyc.new.test.ts` | ❌ all three approved, no review rows | ✅ only the under_review one; one review row |
| existing bulk tests | `apps/api/src/routes/admin.test.ts` | ✅ | ✅ |

```bash
cd apps/api && npx tsx --test src/admin/bulkKyc.new.test.ts src/routes/admin.test.ts
```

Existing tests changed: none.
