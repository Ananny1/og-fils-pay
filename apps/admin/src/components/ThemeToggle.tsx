import { useState } from "react";

type Theme = "light" | "dark";

/** Same storage key and values as apps/web (next-themes): "light" | "dark". */
const STORAGE_KEY = "theme";

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

/** The saved choice, or the OS preference when nothing is saved. Run once at
 *  start-up (main.tsx) in case the inline script in index.html was blocked. */
export function applyInitialTheme(): void {
  const stored = readStoredTheme();
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  applyTheme(stored ?? (prefersDark ? "dark" : "light"));
}

/** Light/dark switch for the staff console — the admin twin of the merchant
 *  dashboard's ThemeToggle (Sun in dark mode, Moon in light mode). */
export function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  function toggle(): void {
    const next: Theme = isDark ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode / blocked storage: the switch still works for this page.
    }
    setIsDark(next === "dark");
  }

  return (
    <button
      type="button"
      className="admin-theme-toggle"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggle}
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      )}
    </button>
  );
}
