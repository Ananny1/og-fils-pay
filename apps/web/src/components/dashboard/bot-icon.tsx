import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * The assistant's mark: a speech bubble with a small robot face and an
 * antenna, so it reads as "chat bot" at a glance. Eyes blink on a loop and
 * glance sideways while `thinking`. Uses currentColor, so it takes the
 * surrounding text colour.
 */
export function BotIcon({
  className,
  animated = true,
  thinking = false,
}: {
  className?: string;
  animated?: boolean;
  thinking?: boolean;
}) {
  const blink = animated
    ? { scaleY: [1, 1, 0.1, 1, 1] , transition: { duration: 4, times: [0, 0.46, 0.5, 0.54, 1], repeat: Infinity } }
    : {};
  const glance = thinking
    ? { x: [0, -1.2, 1.2, 0], transition: { duration: 1.6, repeat: Infinity, ease: "easeInOut" as const } }
    : { x: 0 };

  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={cn("size-5", className)}>
      {/* antenna */}
      <path d="M16 3.5v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <motion.circle
        cx="16"
        cy="3"
        r="1.7"
        fill="currentColor"
        animate={animated ? { opacity: [1, 0.35, 1] } : undefined}
        transition={{ duration: 2.2, repeat: Infinity }}
      />
      {/* speech-bubble head with a tail at the bottom left */}
      <path
        d="M8.5 7.5h15a4.5 4.5 0 0 1 4.5 4.5v8a4.5 4.5 0 0 1-4.5 4.5H13l-5 4v-4.1A4.5 4.5 0 0 1 4 20V12a4.5 4.5 0 0 1 4.5-4.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* face */}
      <motion.g animate={glance}>
        <motion.rect x="10.5" y="13" width="3" height="4.2" rx="1.5" fill="currentColor" style={{ originY: "50%" }} animate={blink} />
        <motion.rect x="18.5" y="13" width="3" height="4.2" rx="1.5" fill="currentColor" style={{ originY: "50%" }} animate={blink} />
      </motion.g>
      <path d="M13.2 20.4c1.6 1 4 1 5.6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
