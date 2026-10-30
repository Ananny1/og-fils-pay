import QRCode from "qrcode";

/**
 * ENH-011 — QR codes for payment links, made in the browser (no third-party
 * QR service ever sees a checkout URL).
 *
 * - Payload: exactly the link's public checkout `url`, nothing added.
 * - Error correction "Q" (~25% recoverable): survives a scuffed counter
 *   sticker and the small FilsPay mark drawn over the centre.
 * - 4-module quiet zone (the spec minimum) and dark ink on a light plate in
 *   both themes — phone cameras read dark-on-light far more reliably.
 */
export const QR_ERROR_CORRECTION = "Q" as const;
export const QR_QUIET_ZONE = 4;
export const QR_INK = "#1e1e1e";
export const QR_PAPER = "#ffffff";
/** Share of the code's width the centre mark may cover (≈4% of its area). */
export const QR_MARK_RATIO = 0.2;

/** The text a payment link's QR encodes: its checkout URL, verbatim. */
export function qrPayload(link: { url: string }): string {
  const url = new URL(link.url); // throws on a malformed URL rather than encoding junk
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`refusing to encode a non-web URL in a payment QR: ${url.protocol}`);
  }
  return link.url;
}

export type ScanToPayState = "active" | "processing" | "paid" | "expired" | "canceled";

/**
 * Whether a merchant's link may show a QR. Only an `active` link that has not
 * passed `expiresAt` does; the stored status never says "expired" (expiry is
 * computed from the timestamp), so it is derived here the same way.
 */
export function scanToPayState(link: { status: string; expiresAt: string }, now: number = Date.now()): ScanToPayState {
  if (link.status === "paid") return "paid";
  if (link.status === "canceled") return "canceled";
  if (Date.parse(link.expiresAt) <= now) return "expired";
  if (link.status === "reserved") return "processing";
  return "active";
}

export interface QrMatrix {
  /** QR version 1-40 (the symbol grows 4 modules per version). */
  version: number;
  /** Modules per side, without the quiet zone. */
  size: number;
  isDark: (row: number, col: number) => boolean;
}

export function buildQrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: QR_ERROR_CORRECTION });
  const { size } = qr.modules;
  return { version: qr.version, size, isDark:(row, col) => Boolean(qr.modules.get(row, col)) };
}

/** Width of the whole symbol in modules, quiet zone included. */
export function qrTotalModules(matrix: QrMatrix): number {
  return matrix.size + QR_QUIET_ZONE * 2;
}

/** One SVG path, a rectangle per horizontal run of dark modules, offset by the quiet zone. */
export function qrSvgPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row++) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < matrix.size && matrix.isDark(row, col)) col++;
      const run = col - start;
      parts.push(`M${start + QR_QUIET_ZONE} ${row + QR_QUIET_ZONE}h${run}v1h-${run}z`);
    }
  }
  return parts.join("");
}

/**
 * The centre mark's square, in modules, snapped to the grid (odd, so it
 * centres exactly) — or `null` from version 7 up, where the symbol has an
 * alignment pattern in the middle that a scanner needs to see.
 */
export function qrMarkBox(matrix: QrMatrix): { start: number; size: number } | null {
  if (matrix.version >= 7) return null;
  let size = Math.round(matrix.size * QR_MARK_RATIO);
  if (size % 2 === 0) size += 1;
  return { start: QR_QUIET_ZONE + (matrix.size - size) / 2, size };
}

/** The text a generated QR carries, read back from its data segments (for tests). */
export function qrEncodedText(text: string): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: QR_ERROR_CORRECTION });
  const decoder = new TextDecoder();
  return qr.segments
    .map((segment) => {
      const data = (segment as unknown as { data: string | Uint8Array }).data;
      return typeof data === "string" ? data : decoder.decode(data);
    })
    .join("");
}
