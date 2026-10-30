/**
 * KYC documents (passports, CR certificates, bank letters) must not sit on
 * disk as readable files (SEC-4). Drives recordKycDocument /
 * getKycDocumentFile directly against a real, migrated Postgres
 * (DATABASE_URL), and reads the upload directory itself to see what an
 * attacker with the disk (or a backup of it) would see.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import sharp from "sharp";
import { loadConfig } from "../config.js";
import { getKycDocumentFile, getKycThumbnailFile, recordKycDocument } from "./kyc.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("kyc.encryption.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const kycUploadDir = mkdtempSync(join(tmpdir(), "filspay-kyc-enc-test-"));
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  KYC_UPLOAD_DIR: kycUploadDir,
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 3 });

test.after(async () => {
  await pool.end();
  await rm(kycUploadDir, { recursive: true, force: true });
});

async function createMerchantUser(): Promise<{ merchantId: string; userId: string }> {
  const suffix = randomUUID();
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, onboarding_status) VALUES ($1, 250, 'submitted') RETURNING id`,
    [`KYC Enc ${suffix.slice(0, 8)}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, password_hash, role)
     VALUES ($1, $2, 'unused-in-these-tests', 'owner') RETURNING id`,
    [merchantId, `kyc-enc-${suffix}@kyc.test`],
  );
  return { merchantId, userId: user.rows[0]!.id };
}

test("a KYC upload is stored encrypted on disk and still downloads as the original bytes", async () => {
  const { merchantId, userId } = await createMerchantUser();
  const original = Buffer.from("%PDF-1.4\n% owner passport scan CPR 900101234\n%%EOF");

  const doc = await recordKycDocument(pool, config, {
    merchantId,
    documentType: "owner_id",
    fileName: "passport.pdf",
    buffer: original,
    uploadedBy: userId,
  });

  const row = await pool.query<{ storage_key: string }>(`SELECT storage_key FROM kyc_documents WHERE id = $1`, [doc.id]);
  const onDisk = await readFile(join(kycUploadDir, row.rows[0]!.storage_key));
  assert.notDeepEqual(onDisk, original, "the file on disk must not be the original bytes");
  assert.equal(onDisk.includes("%PDF"), false, "no PDF header readable on disk");
  assert.equal(onDisk.includes("CPR 900101234"), false, "no document content readable on disk");

  const downloaded = await getKycDocumentFile(pool, config, merchantId, doc.id);
  assert.deepEqual(downloaded.buffer, original);
  assert.equal(downloaded.mimeType, "application/pdf");
});

test("the review thumbnail of an image upload is encrypted on disk too", async () => {
  const { merchantId, userId } = await createMerchantUser();
  const original = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 10, b: 10 } },
  })
    .jpeg()
    .toBuffer();

  const doc = await recordKycDocument(pool, config, {
    merchantId,
    documentType: "owner_id",
    fileName: "id.jpg",
    buffer: original,
    uploadedBy: userId,
  });
  assert.equal(doc.hasThumbnail, true);

  const row = await pool.query<{ thumbnail_storage_key: string }>(
    `SELECT thumbnail_storage_key FROM kyc_documents WHERE id = $1`,
    [doc.id],
  );
  const onDisk = await readFile(join(kycUploadDir, row.rows[0]!.thumbnail_storage_key));
  // JPEG magic bytes FF D8 FF must not be at the start of the stored file.
  assert.notDeepEqual(onDisk.subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff]));

  const thumb = await getKycThumbnailFile(pool, config, merchantId, doc.id);
  const meta = await sharp(thumb.buffer).metadata();
  assert.equal(meta.format, "jpeg");
});

test("a document uploaded before encryption (plaintext on disk) still downloads", async () => {
  const { merchantId, userId } = await createMerchantUser();
  const original = Buffer.from("%PDF-1.4\n% legacy plaintext upload\n%%EOF");
  const storageKey = join(merchantId, "legacy.pdf");
  await mkdir(join(kycUploadDir, merchantId), { recursive: true });
  await writeFile(join(kycUploadDir, storageKey), original);
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO kyc_documents (merchant_id, document_type, file_name, mime_type, file_size_bytes, storage_key, sha256, uploaded_by)
     VALUES ($1, 'owner_id', 'legacy.pdf', 'application/pdf', $2, $3, 'legacy', $4) RETURNING id`,
    [merchantId, original.length, storageKey, userId],
  );

  const downloaded = await getKycDocumentFile(pool, config, merchantId, inserted.rows[0]!.id);
  assert.deepEqual(downloaded.buffer, original);
});
