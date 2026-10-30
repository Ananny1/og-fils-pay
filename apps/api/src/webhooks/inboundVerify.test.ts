/**
 * Unit tests for the inbound acquirer-callback signature verifier. Pure
 * function, no database — the route-level behavior it drives is covered in
 * routes/acquirerCallbacks.test.ts.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { verifyAcquirerCallbackSignature } from "./inboundVerify.js";

const SECRET = "acqsec_test_secret";
const NOW = 1_757_930_000;

/** Builds the header the acquirer would send for the exact raw body bytes —
 *  the same `t=<seconds>,v1=<hex>` shape webhooks/sign.ts uses outbound. */
function acquirerHeader(rawBody: string, secret: string, timestamp = NOW): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

const RAW = JSON.stringify({ callbackId: "acqcb_1", outcome: "cleared" });

test("a correctly-signed callback verifies", () => {
  const result = verifyAcquirerCallbackSignature(RAW, acquirerHeader(RAW, SECRET), SECRET, { now: NOW });
  assert.deepEqual(result, { valid: true });
});

test("a tampered payload is rejected (signature_mismatch)", () => {
  const header = acquirerHeader(RAW, SECRET);
  const tampered = JSON.stringify({ callbackId: "acqcb_1", outcome: "confirmed_fraud" });
  const result = verifyAcquirerCallbackSignature(tampered, header, SECRET, { now: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "signature_mismatch");
});

test("the wrong secret is rejected (signature_mismatch)", () => {
  const header = acquirerHeader(RAW, "acqsec_someone_elses_secret");
  const result = verifyAcquirerCallbackSignature(RAW, header, SECRET, { now: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "signature_mismatch");
});

test("a malformed header is rejected (malformed_header)", () => {
  assert.equal(verifyAcquirerCallbackSignature(RAW, "not-a-real-header", SECRET).reason, "malformed_header");
  assert.equal(verifyAcquirerCallbackSignature(RAW, "t=abc,v1=deadbeef", SECRET).reason, "malformed_header");
  assert.equal(verifyAcquirerCallbackSignature(RAW, "v1=deadbeef", SECRET).reason, "malformed_header");
});

// BUG-007: an unsigned callback used to be accepted unless an env flag
// (default false) said otherwise. The signature is the endpoint's only auth.
test("an unsigned callback is rejected (missing_header)", () => {
  const result = verifyAcquirerCallbackSignature(RAW, undefined, SECRET, { now: NOW });
  assert.deepEqual(result, { valid: false, reason: "missing_header" });
});

test("with no secret configured every callback is rejected, even one 'signed' with the empty key", () => {
  const result = verifyAcquirerCallbackSignature(RAW, acquirerHeader(RAW, ""), "", { now: NOW });
  assert.deepEqual(result, { valid: false, reason: "secret_not_configured" });
});

test("the signature covers the exact raw bytes, not a re-serialisation", () => {
  // Same JSON value, different bytes (whitespace + key order): the acquirer
  // signed the spaced version, so only that exact text verifies.
  const sent = '{ "outcome": "cleared", "callbackId": "acqcb_1" }';
  const header = acquirerHeader(sent, SECRET);
  assert.deepEqual(verifyAcquirerCallbackSignature(sent, header, SECRET, { now: NOW }), { valid: true });
  assert.equal(verifyAcquirerCallbackSignature(RAW, header, SECRET, { now: NOW }).reason, "signature_mismatch");
});

test("a genuine but stale callback is rejected (timestamp_out_of_tolerance)", () => {
  const header = acquirerHeader(RAW, SECRET, NOW - 3600);
  const result = verifyAcquirerCallbackSignature(RAW, header, SECRET, { now: NOW });
  assert.deepEqual(result, { valid: false, reason: "timestamp_out_of_tolerance" });
});
