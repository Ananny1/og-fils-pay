# SEC-4 — KYC documents were saved on disk as plain, readable files

| | |
|---|---|
| **Severity** | High (identity documents of every merchant owner) |
| **Area** | Security (Confidentiality) |
| **Analysis ID** | SEC-4 (security sprint, D-016) |
| **Clue** | "Data protection: no plaintext secrets, KYC at rest" |
| **Decision** | D-016 |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** Passport scans, CR certificates and bank letters were written to disk exactly as uploaded.
- **Why:** `recordKycDocument` in `apps/api/src/onboarding/kyc.ts` called `writeFile(fullPath, input.buffer)` with no encryption.
- **What it breaks:** Anyone who gets the disk, a volume snapshot or a backup can open every owner's ID document.

## 1. The issue

Upload a KYC PDF, then look in `KYC_UPLOAD_DIR/<merchantId>/`. The file there opens in any PDF
reader. Same for the review thumbnail (`*.thumb.jpg`). The database row only holds the path.

## 2. Why it happened

```ts
// apps/api/src/onboarding/kyc.ts (before)
await writeFile(fullPath, input.buffer);
...
await writeFile(join(config.kycUploadDir, thumbnailStorageKey), thumbnail.buffer);
...
const buffer = await readFile(join(config.kycUploadDir, row.storage_key));
```

The platform already had AES-256-GCM for webhook secrets (`webhooks/secretCrypto.ts`) but never
used it for files.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Merchant owners | ID / passport / address proof readable from disk and backups | High |
| FilsPay | Data-protection (PDPL) breach exposure if a volume or backup leaks | High |
| Customers | Not affected | — |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/webhooks/secretCrypto.ts` | New `encryptBytes` / `decryptBytes` (same AES-256-GCM, random IV, `iv‖tag‖ciphertext`). The string functions now call them. Removed a false comment that said encryption is "deterministic". |
| `apps/api/src/config.ts` | New `kycEncryptionKey` from `KYC_ENCRYPTION_KEY`, same 32-byte check; falls back to the webhook key when unset so a running box keeps booting. |
| `apps/api/src/onboarding/kyc.ts` | Document and thumbnail are written encrypted with a `.enc` suffix on the storage key; reads decrypt only `.enc` keys, so old plaintext uploads still download. |
| `apps/api/src/onboarding/kyc.encryption.test.ts` | New: bytes on disk are not the original, download returns the original, thumbnail too, legacy plaintext still works. |
| `apps/api/src/config.test.ts` | Key fallback and bad-key boot failure. |

No migration: the `.enc` suffix on `storage_key` tells old and new files apart. The GCM tag also
detects a file that was changed on disk (download fails instead of serving tampered bytes).

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | App-level AES-256-GCM per file, `.enc` suffix, key from config | Reuses existing crypto; works on any disk; tamper-evident; no migration | Key lives in env (same as webhook key) | ✅ |
| 2 | Same, plus a `encrypted` column (migration) | Explicit flag | Extra migration; same-hash re-upload could overwrite a plaintext file a legacy row still reads | |
| 3 | Disk / volume encryption (LUKS, cloud EBS) only | No code | Does not protect backups copied off the box or a reader inside the container; not testable here | |
| 4 | Store files in Postgres `bytea`, encrypted | One backup | Bloats the DB; large change | |

**Follow-up (ops):** set a dedicated `KYC_ENCRYPTION_KEY` in production; re-encrypt legacy
plaintext files with a one-off script if any exist on the hosted box.

## 6. Proof

| Test | File | Before fix | After fix |
|---|---|---|---|
| stored encrypted on disk, downloads as original | `onboarding/kyc.encryption.test.ts` | ❌ fail | ✅ pass |
| thumbnail encrypted on disk | `onboarding/kyc.encryption.test.ts` | ❌ fail | ✅ pass |
| legacy plaintext upload still downloads | `onboarding/kyc.encryption.test.ts` | ✅ pass | ✅ pass |
| KYC key fallback / bad key refused | `config.test.ts` | ❌ fail | ✅ pass |
| existing KYC route, admin and crypto tests | `app.test.ts`, `routes/admin.test.ts`, `webhooks/secretCrypto.test.ts` | ✅ | ✅ |
| `tsc --noEmit -p apps/api` | | | clean |
