import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";

/**
 * Full-viewport shell for the public pages that render outside the dashboard
 * sidebar (checkout). Plain paper under the dark header strip, with a centred column;
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
  void tone;
  return (
    <div className="relative flex min-h-svh w-full flex-col overflow-x-hidden bg-background text-foreground">
      {/* Same dark header strip as the login page, so the theme toggle is
          reachable on every public page too. */}
      <header className="dark border-b-2 border-b-[#c8102e] bg-[var(--bg-header)] text-[var(--on-dark)]">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 md:px-6">
          <BrandMark />
          <ThemeToggle />
        </div>
      </header>
      <main
        className={cn(
          "relative z-10 mx-auto flex flex-1 w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-10",
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
        className="flex size-9 items-center justify-center bg-[#c8102e] font-heading text-lg font-bold text-[var(--on-dark)]"
      >
        F
      </span>
      <span className="font-heading text-xl font-bold uppercase tracking-wide">FilsPay</span>
    </div>
  );
}
