# SEC-RT-4: The public payment-link page leaks the merchant's API key hash and prefix

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Security (confidentiality, credential material) |
| **Analysis ID** | Security sprint, red-team finding SEC-RT-4 (lens: access) |
| **Clue** | `paymentLinks/read.ts` DTO comment "Contains nothing that identifies or authenticates the merchant beyond its display name" (false) |
| **Decision** | D-016 (security sprint) |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** Anyone who opens a payment link (no login) sees the merchant's live API key prefix and the exact sha256 hash stored for that key.
- **Why:** `getPublicPaymentLink` joins the merchant's newest non-revoked `api_keys` row and returns `key_prefix` as `merchantPublicKey` and `key_hash` as `merchantIntegrationId`.
- **What it breaks:** Payment links go to customers, so the server-side verifier of a merchant's API key is public and tied to the merchant's name. The red team could not log in with it (the real key is 192-bit random, and `verifyApiKey` hashes what it is sent), so this is a secret leak, not a login bypass. It still breaks the rule that key hashes never appear in API responses, and helps any attacker who gets a partial key or a DB dump.

## 1. The issue

To reproduce: `curl http://<api>/v1/payment-links/<token>` with no cookie and no bearer. Before the
fix the JSON contained `"merchantPublicKey":"fp_test_3mIt-zcW"` and
`"merchantIntegrationId":"9235...0a81"`, byte-for-byte equal to `api_keys.key_hash` for that
merchant.

## 2. Why it happened

`apps/api/src/paymentLinks/read.ts` had a `LEFT JOIN LATERAL` on `api_keys` (newest non-revoked
key) and mapped both columns into `PublicPaymentLinkDto`. Nothing in the API, the web checkout or
the admin app reads these two fields; only one test asserted `merchantPublicKey` starts with `fp_`.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchants | Their API key prefix and hash are visible to every customer and anyone a link is forwarded to | Medium |
| FilsPay staff / ops | Credential material in a public response; breaks the stated security rule | Medium |
| Customers | None directly | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/paymentLinks/read.ts` | Dropped the `api_keys` LATERAL join and the `merchantPublicKey` / `merchantIntegrationId` fields from the row type, DTO and mapping; DTO comment now true |
| `apps/api/src/routes/paymentLinks.test.ts` | The happy-path test asserted `merchantPublicKey` starts with `fp_`, which encoded the bug. It now asserts both fields are absent and that the body contains neither the key hash nor the key prefix |

The query is now smaller (one fewer lookup per public read). No new state or index.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Remove both fields and the `api_keys` join | Smallest; nothing consumes them; query gets cheaper | A client that wanted a merchant id loses it (none exists) | ✅ |
| 2 | Keep `merchantPublicKey` (prefix only), drop the hash | Less change to the DTO | The prefix still ties a live key to a merchant name publicly; no consumer needs it | |
| 3 | Add a dedicated non-secret public merchant id column and expose that | Gives integrations a stable id | New migration and column for a need nobody has | Later, if needed |
| 4 | Hash the hash again / truncate it | Hides the exact verifier | Still key-derived material on a public page; pointless | |

## 6. Proof: tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `create -> public read (active) -> pay ...` (now asserts no key prefix/hash in the body) | `apps/api/src/routes/paymentLinks.test.ts` | ❌ fields present | ✅ |
| other payment-link route tests (9) | same | ✅ | ✅ (10/10) |
| `tsc --noEmit -p apps/api` | | ✅ | ✅ |

Existing test changed: the `merchantPublicKey?.startsWith("fp_")` assertion encoded the leak, so
it was replaced with the opposite check.
