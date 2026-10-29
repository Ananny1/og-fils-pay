import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import type { MouseEvent } from "react";
import CountUp from "@/components/ui/CountUp";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { formatMoney } from "@/components/dashboard/money";

/* Illustrative rows for the sign-in page. Amounts are integer fils and are
   summed as integers; display goes through formatMoney like everywhere else. */
const ROWS: Array<{ ref: string; time: string; fils: number; status: string }> = [
  { ref: "seef-kiosk-0412", time: "21:14", fils: 4755, status: "captured" },
  { ref: "seef-kiosk-0413", time: "21:31", fils: 12348, status: "captured" },
  { ref: "seef-kiosk-0414", time: "22:02", fils: 8000, status: "partially_captured" },
  { ref: "seef-kiosk-0415", time: "23:47", fils: 150031, status: "captured" },
];
const GROSS = ROWS.reduce((sum, r) => sum + r.fils, 0);
const FEE = 3937; // 2.25% of gross, banker's-rounded, as the fee engine would post it
const NET = GROSS - FEE;

function bd(fils: number): number {
  return Number(formatMoney(fils).replaceAll(",", ""));
}

/** Pointer-following 3D tilt, springy, resets on leave. */
function Tilt({ children, className }: { children: React.ReactNode; className?: string }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [7, -7]), { stiffness: 180, damping: 18 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-9, 9]), { stiffness: 180, damping: 18 });
  function onMove(e: MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - r.left) / r.width - 0.5);
    y.set((e.clientY - r.top) / r.height - 0.5);
  }
  function onLeave() {
    x.set(0);
    y.set(0);
  }
  return (
    <motion.div
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d", perspective: 900 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** A small, animated picture of what the product does: a business day
 *  closing into one batch. Rows land one by one, then the totals count up. */
export function BatchPreview() {
  return (
    <Tilt className="w-full max-w-md [perspective:900px]">
      <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-elegant">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Tonight&apos;s batch</p>
            <p className="mt-0.5 text-sm font-semibold">Seef Kiosk Partners · 29 Oct</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-warning/70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-warning" />
            </span>
            Closes 00:00
          </span>
        </div>

        <ul className="mt-4 divide-y divide-border/60">
          {ROWS.map((r, i) => (
            <motion.li
              key={r.ref}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 + i * 0.18, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center justify-between gap-3 py-2.5 text-sm"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">{r.time}</span>
                <span className="truncate font-mono text-[13px]">{r.ref}</span>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={r.status} className="hidden sm:inline-flex" />
                <span className="font-mono tabular-nums">{formatMoney(r.fils)}</span>
              </div>
            </motion.li>
          ))}
        </ul>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.25, duration: 0.5 }}
          className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-muted/50 p-3"
        >
          {[
            ["Gross", GROSS],
            ["Fee 2.25%", FEE],
            ["Net payout", NET],
          ].map(([label, fils]) => (
            <div key={String(label)}>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                <CountUp to={bd(Number(fils))} decimals={3} separator="," duration={1.2} delay={1.3} trigger="load" />
              </p>
            </div>
          ))}
        </motion.div>
      </div>
    </Tilt>
  );
}
