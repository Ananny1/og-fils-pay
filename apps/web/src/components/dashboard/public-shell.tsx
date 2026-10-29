import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import Aurora from "@/components/Aurora";
import { cn } from "@/lib/utils";

/**
 * Full-viewport shell for the public pages that render outside the dashboard
 * sidebar (login, checkout). An `Aurora` wash sits behind a centred column;
 * the page itself supplies the card. `tone="calm"` is the quieter variant for
 * the customer-facing pay page.
 */
export function PublicShell({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "calm";
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const calm = tone === "calm";
  const dark = resolvedTheme === "dark";
  // The off-white stop is additive in dark mode, so the wash is dialled down
  // there; in light mode the shader already caps lightness and tints instead.
  const opacity = dark ? (calm ? 0.35 : 0.5) : calm ? 0.55 : 0.8;
  return (
    <div className="relative min-h-svh w-full overflow-x-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[55svh] min-h-80" aria-hidden="true">
        <Aurora
          colorStops={["#f43325", "#ff8a7a", "#1b2a4a"]}
          amplitude={calm ? 0.35 : 0.6}
          blend={0.65}
          speed={calm ? 0.4 : 0.6}
          height={calm ? 0.32 : 0.4}
          glow={0.45}
          brightness={calm ? 0.8 : 0.95}
          opacity={opacity}
          mouseInteraction={false}
          lightMode={!dark}
        />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-background" />
      </div>
      <main
        className={cn(
          "relative z-10 mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-10",
          className,
        )}
      >
        {children}
      </main>
    </div>
  );
}

/** The "F" square + wordmark used on public pages. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-lg bg-primary font-heading text-lg font-semibold text-primary-foreground shadow-sm"
      >
        F
      </span>
      <span className="font-heading text-lg font-semibold tracking-tight">FilsPay</span>
    </div>
  );
}
