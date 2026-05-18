"use client";

import { useEffect, useRef, useState } from "react";
import { useHiddenSections } from "./section-visibility-context";

export function HiddenSectionsMenu() {
  const { hiddenSections, unhide, unhideAll } = useHiddenSections();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (hiddenSections.length === 0) return null;

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-fg-subtle transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span>Hidden</span>
        <span className="tabular-nums text-fg-muted">{hiddenSections.length}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-10 mb-2 min-w-[180px] rounded-md border border-border bg-bg-elevated p-1 text-[12px] shadow-md"
        >
          {hiddenSections.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              onClick={() => unhide(s.id)}
              className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-fg-muted transition-colors duration-150 ease-out motion-reduce:duration-0 hover:bg-bg hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span>{s.label}</span>
              <span className="text-[11px] text-fg-subtle">show</span>
            </button>
          ))}
          {hiddenSections.length > 1 && (
            <>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                onClick={unhideAll}
                className="block w-full rounded px-2 py-1.5 text-left text-fg-muted transition-colors duration-150 ease-out motion-reduce:duration-0 hover:bg-bg hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Show all
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
