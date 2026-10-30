import assert from "node:assert/strict";
import test from "node:test";
import {
  QR_INK,
  QR_PAPER,
  QR_QUIET_ZONE,
  buildQrMatrix,
  qrEncodedText,
  qrMarkBox,
  qrPayload,
  qrSvgPath,
  qrTotalModules,
  scanToPayState,
} from "./qr.js";

/**
 * ENH-011 — what a payment-link QR encodes. A QR that encodes anything other
 * than the link's own checkout URL (a tracking redirect, a trimmed token, a
 * third-party QR service URL) would send a paying customer somewhere else.
 */

const LOCAL = "http://localhost:5173/pay/q9X2mVb7Lr0aT_Zk-4yWcPdE1sNfH8uJ";
const PROD = "https://pay.filspay.example/pay/q9X2mVb7Lr0aT_Zk-4yWcPdE1sNfH8uJ";

test("the QR payload is exactly the link's url — nothing added, nothing trimmed", () => {
  for (const url of [LOCAL, PROD, `${PROD}?utm=x`]) {
    assert.equal(qrPayload({ url }), url);
  }
});

test("the generated symbol encodes the url byte-for-byte", () => {
  for (const url of [LOCAL, PROD, "https://pay.filspay.example/pay/ABCDEFGHIJ0123456789"]) {
    assert.equal(qrEncodedText(qrPayload({ url })), url);
  }
});

test("a non-web or malformed url is refused, never encoded", () => {
  assert.throws(() => qrPayload({ url: "javascript:alert(1)" }));
  assert.throws(() => qrPayload({ url: "not a url" }));
  assert.throws(() => qrPayload({ url: "" }));
});

test("the symbol is scannable-shaped: square, finder patterns, dark-on-light, 4-module quiet zone", () => {
  const matrix = buildQrMatrix(PROD);
  assert.equal(matrix.size, 17 + 4 * matrix.version);
  // Top-left finder pattern: 7x7 dark ring with a dark 3x3 centre.
  for (let i = 0; i < 7; i++) {
    assert.ok(matrix.isDark(0, i) && matrix.isDark(6, i) && matrix.isDark(i, 0) && matrix.isDark(i, 6));
  }
  assert.ok(matrix.isDark(3, 3));
  assert.ok(!matrix.isDark(1, 1));
  assert.equal(qrTotalModules(matrix), matrix.size + 2 * QR_QUIET_ZONE);
  assert.equal(QR_QUIET_ZONE, 4);
  // Dark ink on a light plate, whatever the page theme.
  assert.equal(QR_PAPER, "#ffffff");
  assert.equal(QR_INK, "#1e1e1e");
  // The path starts inside the quiet zone, never on its edge.
  assert.match(qrSvgPath(matrix), /^M4 4h7v1h-7z/);
});

test("the centre mark stays small and is dropped once a centre alignment pattern exists", () => {
  const small = buildQrMatrix(LOCAL);
  const mark = qrMarkBox(small);
  assert.ok(mark, "expected a mark on a small symbol");
  assert.equal(mark.size % 2, 1);
  assert.ok((mark.size * mark.size) / (small.size * small.size) < 0.06, "mark must cover < 6% of the symbol");
  const big = buildQrMatrix(`${PROD}/${"x".repeat(120)}`);
  assert.ok(big.version >= 7);
  assert.equal(qrMarkBox(big), null);
});

test("only an active, unexpired link shows a QR", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const future = "2026-10-31T12:00:00Z";
  const past = "2026-10-29T12:00:00Z";
  assert.equal(scanToPayState({ status: "active", expiresAt: future }, now), "active");
  assert.equal(scanToPayState({ status: "active", expiresAt: past }, now), "expired");
  assert.equal(scanToPayState({ status: "active", expiresAt: "2026-10-30T12:00:00Z" }, now), "expired");
  assert.equal(scanToPayState({ status: "reserved", expiresAt: future }, now), "processing");
  assert.equal(scanToPayState({ status: "paid", expiresAt: past }, now), "paid");
  assert.equal(scanToPayState({ status: "canceled", expiresAt: future }, now), "canceled");
});
