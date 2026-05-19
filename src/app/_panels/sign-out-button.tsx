"use client";

import { cn } from "@/lib/utils";
import { signOutAction } from "./sign-out-action";

type Size = "sm" | "md";

export function SignOutButton({
  size = "sm",
  className,
}: {
  size?: Size;
  className?: string;
}) {
  const compact = size === "sm";
  const ariaLabel = "Sign out (reconnect Google)";
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        aria-label={ariaLabel}
        title={ariaLabel}
        className={cn(
          "inline-flex items-center justify-center rounded-md border border-border bg-bg transition-colors duration-200 ease-out motion-reduce:duration-0 hover:bg-bg-elevated motion-safe:active:scale-[0.98]",
          compact ? "h-7 w-7" : "h-9 w-9",
          className,
        )}
      >
        <SignOutGlyph className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </button>
    </form>
  );
}

function SignOutGlyph({ className }: { className?: string }) {
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
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h12" />
    </svg>
  );
}
