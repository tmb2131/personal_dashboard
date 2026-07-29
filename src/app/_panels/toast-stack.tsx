"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const CONTAINER_ID = "toast-stack";

/**
 * Shared bottom-right viewport for transient toasts.
 *
 * Sync and Reconcile each used to render their own `fixed right-4 bottom-4`
 * box, so firing both stacked them on top of each other. Portalling into one
 * flex column instead lets concurrent toasts queue upward.
 *
 * Positioned with inline styles rather than utility classes because the element
 * is created imperatively, outside anything Tailwind scans.
 */
function getToastContainer(): HTMLElement | null {
  if (typeof document === "undefined") return null;

  const existing = document.getElementById(CONTAINER_ID);
  if (existing) return existing;

  const el = document.createElement("div");
  el.id = CONTAINER_ID;
  el.style.cssText = [
    "position:fixed",
    "right:1rem",
    "bottom:1rem",
    "z-index:50",
    "display:flex",
    "flex-direction:column-reverse",
    "align-items:flex-end",
    "gap:0.5rem",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(el);
  return el;
}

export function Toast({
  className,
  children,
}: {
  /** Tone classes (border/background/text) supplied by the caller. */
  className?: string;
  children: ReactNode;
}) {
  // Lazy initialiser rather than an effect: a Toast only ever mounts in
  // response to a user action, long after hydration, so the container can be
  // resolved on first render. It is shared and empty when idle, so it stays put.
  const [container] = useState(getToastContainer);
  if (!container) return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none max-w-[28rem] rounded-md border px-3 py-2 text-[12px] shadow-lg backdrop-blur",
        className,
      )}
    >
      {children}
    </div>,
    container,
  );
}
