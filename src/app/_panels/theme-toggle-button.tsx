"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { currentTheme, THEME_CHANGE_EVENT, toggleTheme, type Theme } from "@/lib/theme";

type Variant = "label" | "icon";
type Size = "sm" | "md";

function subscribeToTheme(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
}

export function ThemeToggleButton({
  variant = "label",
  size = "sm",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
}) {
  const theme = useSyncExternalStore<Theme | null>(
    subscribeToTheme,
    () => currentTheme(),
    () => null,
  );

  const handleClick = () => {
    toggleTheme();
  };

  const isDark = theme === "dark";
  const targetLabel = isDark ? "light" : "dark";
  const ariaLabel = `Switch to ${targetLabel} theme (Shift+D)`;

  if (variant === "icon") {
    const compact = size === "sm";
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={ariaLabel}
        title={ariaLabel}
        className={cn(
          "inline-flex items-center justify-center rounded-md border border-border bg-bg transition-colors duration-200 ease-out motion-reduce:duration-0 hover:bg-bg-elevated motion-safe:active:scale-[0.98]",
          compact ? "h-7 w-7" : "h-9 w-9",
          className,
        )}
      >
        {isDark ? (
          <SunGlyph className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        ) : (
          <MoonGlyph className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(
        "rounded-sm text-fg-subtle transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
    >
      dark/light
    </button>
  );
}

function SunGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
