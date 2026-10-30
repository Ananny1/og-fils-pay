import { CHECKOUT_STRINGS, formatCheckoutAmount } from "../../i18n/checkout.js";
import { ensureArabicFont } from "../../i18n/use-checkout-lang.js";
import { dateTime } from "../../format.js";
import { QR_INK, QR_PAPER, QR_QUIET_ZONE, buildQrMatrix, qrMarkBox, qrTotalModules } from "@/lib/qr";

/**
 * ENH-011 — the "Download QR" PNG: a printable 4:5 counter card (1080×1350)
 * in the case-file palette, drawn on a canvas in the browser. Merchant, amount,
 * the QR, the bilingual caption and the expiry, so a printed copy still makes
 * sense on its own.
 */
export interface QrPosterInput {
  url: string;
  merchant: string;
  amountFils: number;
  currency: string;
  expiresAt: string;
}

const W = 1080;
const H = 1350;
const PAPER = "#faf8f3";
const TEXT = "#2b2b2b";
const MUTED = "#6b6b6b";
const RED = "#c8102e";

async function loadFonts(): Promise<void> {
  ensureArabicFont();
  const faces = [
    '700 40px "Oswald"',
    '600 40px "IBM Plex Mono"',
    '500 40px "Inter"',
    '500 40px "IBM Plex Sans Arabic"',
  ];
  try {
    await Promise.race([
      Promise.all(faces.map((face) => document.fonts.load(face, face.includes("Arabic") ? "ادفع" : "FilsPay 0.5"))),
      new Promise((resolve) => setTimeout(resolve, 2500)), // never block the download on a slow font CDN
    ]);
  } catch {
    // fall back to whatever the browser has
  }
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export async function renderQrPoster(input: QrPosterInput): Promise<Blob> {
  await loadFonts();
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, W, 14);

  // Brand: red "F" square + wordmark, centred.
  ctx.font = '700 44px "Oswald", "Arial Narrow", sans-serif';
  const word = "FILSPAY";
  const wordWidth = ctx.measureText(word).width;
  const brandX = (W - (64 + 18 + wordWidth)) / 2;
  ctx.fillStyle = RED;
  ctx.fillRect(brandX, 70, 64, 64);
  ctx.fillStyle = "#f4f1ea";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("F", brandX + 32, 104);
  ctx.fillStyle = TEXT;
  ctx.textAlign = "left";
  ctx.fillText(word, brandX + 82, 104);

  ctx.textAlign = "center";
  ctx.fillStyle = MUTED;
  ctx.font = '500 36px "Inter", sans-serif';
  ctx.fillText(fitText(ctx, input.merchant, W - 160), W / 2, 196);

  ctx.fillStyle = TEXT;
  ctx.font = '600 88px "IBM Plex Mono", monospace';
  ctx.fillText(formatCheckoutAmount(input.amountFils, "en", input.currency), W / 2, 282);

  // The QR plate.
  const matrix = buildQrMatrix(input.url);
  const total = qrTotalModules(matrix);
  const module = Math.floor(680 / total);
  const side = module * total;
  const x0 = Math.round((W - side) / 2);
  const y0 = 350;
  ctx.fillStyle = QR_PAPER;
  ctx.fillRect(x0, y0, side, side);
  ctx.strokeStyle = "#cfcac0";
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 - 1, y0 - 1, side + 2, side + 2);
  ctx.fillStyle = QR_INK;
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (matrix.isDark(row, col)) {
        ctx.fillRect(x0 + (col + QR_QUIET_ZONE) * module, y0 + (row + QR_QUIET_ZONE) * module, module, module);
      }
    }
  }
  const mark = qrMarkBox(matrix);
  if (mark) {
    const mx = x0 + mark.start * module;
    const my = y0 + mark.start * module;
    const ms = mark.size * module;
    const inset = Math.round(module * 0.7);
    ctx.fillStyle = QR_PAPER;
    ctx.fillRect(mx, my, ms, ms);
    ctx.fillStyle = RED;
    ctx.fillRect(mx + inset, my + inset, ms - inset * 2, ms - inset * 2);
    ctx.fillStyle = "#f4f1ea";
    ctx.font = `700 ${Math.round(ms * 0.62)}px "Oswald", sans-serif`;
    ctx.fillText("F", mx + ms / 2, my + ms / 2 + 2);
  }

  const captionY = y0 + side + 70;
  ctx.fillStyle = TEXT;
  ctx.font = '500 38px "Inter", sans-serif';
  ctx.fillText(CHECKOUT_STRINGS.en.scanToPay, W / 2, captionY);
  ctx.direction = "rtl";
  ctx.font = '500 40px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(CHECKOUT_STRINGS.ar.scanToPay, W / 2, captionY + 62);
  ctx.direction = "ltr";

  ctx.fillStyle = MUTED;
  ctx.font = '400 26px "IBM Plex Mono", monospace';
  ctx.fillText(`${CHECKOUT_STRINGS.en.expires(dateTime(input.expiresAt))} · Bahrain time`, W / 2, H - 92);
  ctx.font = '400 20px "IBM Plex Mono", monospace';
  ctx.fillText(fitText(ctx, input.url, W - 160), W / 2, H - 52);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))), "image/png");
  });
}

/** Saves a blob through a temporary object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
