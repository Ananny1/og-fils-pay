import { createHmac } from "node:crypto";
import { timingSafeEqualHex } from "../lib/crypto.js";

/** Verifies the signature on an inbound acquirer callback. */

interface ParsedAcquirerSignatureHeader {
  timestamp: number;
  signature: string;
}

function parseAcquirerSignatureHeader(header: string): ParsedAcquirerSignatureHeader | null {
  let timestampStr: string | null = null;
  let signature: string | null = null;

  for (const part of header.split(",")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (key === "t") timestampStr = value;
    else if (key === "v1") signature = value;
  }

  if (!timestampStr || !signature) return null;
  if (!/^\d+$/.test(timestampStr)) return null;

  const timestamp = Number.parseInt(timestampStr, 10);
  if (!Number.isFinite(timestamp)) return null;

  return { timestamp, signature };
}

export type VerifyAcquirerCallbackFailureReason =
  | "missing_header"
  | "malformed_header"
  | "signature_mismatch"
  | "timestamp_out_of_tolerance"
  | "secret_not_configured";

export interface VerifyAcquirerCallbackResult {
  valid: boolean;
  reason?: VerifyAcquirerCallbackFailureReason;
}

/**
 * Verifies the acquirer callback signature (BUG-007). Always required: this
 * header is the endpoint's only authentication, so a missing header, an
 * unset secret, a wrong MAC or a stale timestamp are all rejections.
 *
 * `rawBody` must be the exact bytes received, never a re-serialisation of
 * the parsed object, whose key order / whitespace / number formatting need
 * not match what the acquirer signed. The compare is constant-time and the
 * timestamp (which is inside the MAC) must be within `toleranceSeconds` of
 * now, so a captured callback can't be replayed later.
 */
export function verifyAcquirerCallbackSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  options?: { toleranceSeconds?: number; now?: number },
): VerifyAcquirerCallbackResult {
  if (!secret) return { valid: false, reason: "secret_not_configured" };
  if (!header) return { valid: false, reason: "missing_header" };

  const parsed = parseAcquirerSignatureHeader(header);
  if (!parsed) return { valid: false, reason: "malformed_header" };

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${rawBody}`)
    .digest("hex");

  if (!timingSafeEqualHex(expected, parsed.signature)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  const now = options?.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options?.toleranceSeconds ?? 300;
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { valid: false, reason: "timestamp_out_of_tolerance" };
  }

  return { valid: true };
}
