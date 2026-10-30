import { useMemo } from "react";
import { QR_INK, QR_PAPER, buildQrMatrix, qrMarkBox, qrSvgPath, qrTotalModules } from "@/lib/qr";
import { cn } from "@/lib/utils";

/**
 * A crisp, scalable QR (inline SVG built from the module matrix — no
 * `dangerouslySetInnerHTML`, no network). Always dark ink on a light plate,
 * whatever the page theme, with the FilsPay "F" in the centre when it fits.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const matrix = useMemo(() => buildQrMatrix(value), [value]);
  const path = useMemo(() => qrSvgPath(matrix), [matrix]);
  const total = qrTotalModules(matrix);
  const mark = qrMarkBox(matrix);
  const inset = 0.7;

  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn("block h-auto w-full", className)}
    >
      <rect width={total} height={total} fill={QR_PAPER} />
      <path d={path} fill={QR_INK} />
      {mark ? (
        <g>
          <rect x={mark.start} y={mark.start} width={mark.size} height={mark.size} fill={QR_PAPER} />
          <rect
            x={mark.start + inset}
            y={mark.start + inset}
            width={mark.size - inset * 2}
            height={mark.size - inset * 2}
            fill="#c8102e"
          />
          <text
            x={mark.start + mark.size / 2}
            y={mark.start + mark.size / 2 + mark.size * 0.03}
            fill="#f4f1ea"
            fontFamily="Oswald, 'Arial Narrow', sans-serif"
            fontWeight={700}
            fontSize={mark.size * 0.66}
            textAnchor="middle"
            dominantBaseline="central"
            shapeRendering="geometricPrecision"
          >
            F
          </text>
        </g>
      ) : null}
    </svg>
  );
}
