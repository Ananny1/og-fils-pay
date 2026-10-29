import { CalendarClock, Coins, CreditCard, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { motion, useMotionValue, useScroll, useSpring, useTransform } from "motion/react";
import { BotIcon } from "@/components/dashboard/bot-icon";

const SIZE = 220; // px, edge length
const HALF = SIZE / 2;

interface Face {
  transform: string;
  icon: ReactNode;
  kicker: string;
  title: string;
  body: string;
}

const FACES: Face[] = [
  {
    transform: `rotateY(0deg) translateZ(${HALF}px)`,
    icon: <span className="text-2xl font-bold">F</span>,
    kicker: "FilsPay",
    title: "Card payments for Bahrain",
    body: "Built for the dinar, from the first fil.",
  },
  {
    transform: `rotateY(90deg) translateZ(${HALF}px)`,
    icon: <Coins className="size-6" />,
    kicker: "Money",
    title: "1 BD = 1000 fils",
    body: "Every amount kept as whole fils. Nothing rounded away.",
  },
  {
    transform: `rotateY(180deg) translateZ(${HALF}px)`,
    icon: <CalendarClock className="size-6" />,
    kicker: "Payouts",
    title: "Closes at 00:00",
    body: "Each Bahrain day becomes one payout to your bank.",
  },
  {
    transform: `rotateY(-90deg) translateZ(${HALF}px)`,
    icon: <BotIcon className="size-7" animated={false} />,
    kicker: "Ask FilsPay",
    title: "Answers from your data",
    body: "Ask about sales, fees or payouts in plain words.",
  },
  {
    transform: `rotateX(90deg) translateZ(${HALF}px)`,
    icon: <CreditCard className="size-6" />,
    kicker: "Cards",
    title: "Visa · Mastercard",
    body: "Payment links your customers open on any phone.",
  },
  {
    transform: `rotateX(-90deg) translateZ(${HALF}px)`,
    icon: <ShieldCheck className="size-6" />,
    kicker: "Trust",
    title: "Signed webhooks",
    body: "Every message to your server can be checked.",
  },
];

/**
 * A 3D cube whose six faces carry FilsPay's themes. It turns as the page
 * scrolls (one face per stretch of scroll) and can be dragged to spin.
 * Pure CSS 3D transforms driven by motion values; no WebGL.
 */
export function ThemeCube() {
  const { scrollYProgress } = useScroll();
  // Scroll turns it one and a half times around Y and tips it over X.
  const scrollY = useTransform(scrollYProgress, [0, 1], [-20, 520]);
  const scrollX = useTransform(scrollYProgress, [0, 0.5, 1], [-14, 70, -14]);

  // Dragging adds its own offset on top of the scroll-driven angle.
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const rotY = useSpring(useTransform([scrollY, dragX], ([s, d]: number[]) => (s ?? 0) + (d ?? 0)), {
    stiffness: 90,
    damping: 18,
  });
  const rotX = useSpring(useTransform([scrollX, dragY], ([s, d]: number[]) => (s ?? 0) - (d ?? 0)), {
    stiffness: 90,
    damping: 18,
  });

  return (
    <div className="flex flex-col items-center gap-5 select-none">
      <div className="relative" style={{ width: SIZE, height: SIZE, perspective: 900 }}>
        {/* soft floor glow */}
        <div
          aria-hidden
          className="absolute -bottom-12 left-1/2 h-10 w-48 -translate-x-1/2 rounded-full bg-primary/25 blur-2xl"
        />
        <motion.div
          className="relative size-full cursor-grab active:cursor-grabbing"
          style={{ transformStyle: "preserve-3d", rotateX: rotX, rotateY: rotY }}
          onPan={(_, info) => {
            dragX.set(dragX.get() + info.delta.x * 0.6);
            dragY.set(dragY.get() + info.delta.y * 0.6);
          }}
          aria-label="FilsPay themes. Scroll or drag to turn."
          role="img"
        >
          {FACES.map((f) => (
            <div
              key={f.title}
              className="absolute inset-0 flex flex-col justify-between rounded-2xl border border-primary/25 bg-card/95 p-5 text-left shadow-elegant backdrop-blur-sm"
              style={{ transform: f.transform, backfaceVisibility: "hidden" }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-2xl"
                style={{
                  background:
                    "radial-gradient(140px circle at 0% 0%, color-mix(in oklch, var(--primary) 16%, transparent), transparent 70%)",
                }}
              />
              <span className="relative flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-elegant">
                {f.icon}
              </span>
              <div className="relative">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">{f.kicker}</p>
                <p className="mt-1 text-lg font-bold leading-snug tracking-tight">{f.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{f.body}</p>
              </div>
            </div>
          ))}
        </motion.div>
      </div>
      <p className="text-xs text-muted-foreground">Scroll or drag to turn</p>
    </div>
  );
}
