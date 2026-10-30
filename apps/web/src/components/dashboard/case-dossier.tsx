import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";

interface Exhibit {
  id: string;
  title: string;
  body: string;
  stamp: string;
  ink: "red" | "dark";
  note?: string;
}

const EXHIBITS: Exhibit[] = [
  {
    id: "A",
    title: "1 BD = 1000 fils",
    body: "Every amount is kept as whole fils, from the card to your bank. Nothing is rounded away.",
    stamp: "Verified",
    ink: "dark",
    note: "to the fil",
  },
  {
    id: "B",
    title: "Closed at 00:00",
    body: "Each Bahrain day is sealed at midnight and becomes one payout: sold, fee, net.",
    stamp: "Filed",
    ink: "red",
  },
  {
    id: "C",
    title: "Ask FilsPay",
    body: "Questions about sales, fees and payouts, answered from your own records in plain words.",
    stamp: "Read only",
    ink: "dark",
    note: "can't move money",
  },
  {
    id: "D",
    title: "Signed messages",
    body: "Every webhook we send carries a signature your server can check before trusting it.",
    stamp: "Sealed",
    ink: "red",
  },
];

/** Where a sheet sits in the pile, by how far behind the front it is. */
function pose(depth: number) {
  const tilt = [-1.5, 2.5, -3.5, 4][depth] ?? 0;
  return { rotate: tilt, x: depth * 7, y: depth * 9, scale: 1 - depth * 0.025, zIndex: 10 - depth };
}

/**
 * A manila case folder with a pile of evidence sheets. Scrolling the page
 * flips to the next sheet; clicking the pile does too. Decorative: the same
 * facts are in the page text, so it is hidden from screen readers.
 */
export function CaseDossier() {
  const [front, setFront] = useState(0);
  const { scrollYProgress } = useScroll();
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    const i = Math.min(EXHIBITS.length - 1, Math.floor(v * EXHIBITS.length * 1.4));
    setFront((cur) => (cur === i ? cur : i));
  });

  const order = EXHIBITS.map((_, k) => (front + k) % EXHIBITS.length);

  return (
    <div aria-hidden className="relative mx-auto w-[300px] select-none pt-7">
      {/* folder tab */}
      <div className="absolute top-0 left-6 h-8 w-52 whitespace-nowrap border border-b-0 border-[#7a6a4f] bg-[#d9c79f] px-3 pt-1.5 font-mono text-[10px] font-semibold tracking-[0.15em] text-[#4a3d26] uppercase">
        Case FP-2026 · FilsPay
      </div>
      {/* folder back */}
      <div className="relative h-[340px] border border-[#7a6a4f] bg-[#e3d3ab] p-5 shadow-[inset_0_-40px_60px_-40px_rgba(74,61,38,0.25)]">
        <div className="relative h-full cursor-pointer" onClick={() => setFront((f) => (f + 1) % EXHIBITS.length)}>
          <AnimatePresence initial={false}>
            {order
              .slice()
              .reverse()
              .map((idx) => {
                const e = EXHIBITS[idx]!;
                const depth = order.indexOf(idx);
                return (
                  <motion.article
                    key={e.id}
                    initial={false}
                    animate={pose(depth)}
                    transition={{ type: "spring", stiffness: 210, damping: 22 }}
                    className="absolute inset-0 flex flex-col border border-[#2b2b2b] bg-[#faf8f3] p-5"
                    style={{ transformOrigin: "40% 80%" }}
                  >
                    {/* paper clip */}
                    <svg className="absolute -top-4 right-8 h-12 w-5 text-[#8a8a8a]" viewBox="0 0 20 48" fill="none">
                      <path
                        d="M6 40V9a5 5 0 0 1 10 0v29a7 7 0 0 1-14 0V12"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                      />
                    </svg>
                    <p className="case-label">Exhibit {e.id}</p>
                    <p className="mt-4 font-heading text-[1.9rem] leading-none font-bold uppercase text-[#2b2b2b]">{e.title}</p>
                    <p className="mt-3 text-[13px] leading-6 text-[#4a4a4a]">{e.body}</p>
                    {e.note ? <p className="case-note mt-2 -rotate-2">{e.note}</p> : null}
                    <div className="mt-auto flex items-end justify-between">
                      <span className="font-mono text-[10px] tracking-[0.12em] text-[#6b6b6b] uppercase">
                        Sheet {idx + 1} / {EXHIBITS.length}
                      </span>
                      <span
                        className={`case-stamp text-[12px] ${e.ink === "dark" ? "case-stamp--ink" : ""}`}
                        style={{ transform: "rotate(-8deg)" }}
                      >
                        {e.stamp}
                      </span>
                    </div>
                  </motion.article>
                );
              })}
          </AnimatePresence>
        </div>
      </div>
      <p className="mt-4 text-center font-mono text-[10px] tracking-[0.15em] text-muted-foreground uppercase">
        Scroll or click to turn the page
      </p>
    </div>
  );
}
