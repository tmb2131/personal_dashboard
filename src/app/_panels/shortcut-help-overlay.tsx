"use client";

import { useEffect, useState, type ReactNode } from "react";
import { isEditableTarget } from "@/lib/utils";

export function ShortcutHelpOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onShortcut = (ev: Event) => {
      const detail = (ev as CustomEvent<{ type?: string }>).detail;
      if (detail?.type === "help") setOpen((v) => !v);
    };
    window.addEventListener("dashboard-shortcut", onShortcut);
    return () => window.removeEventListener("dashboard-shortcut", onShortcut);
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-50 flex items-start justify-center bg-bg/70 px-4 pt-24 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-bg-elevated p-5 shadow-lg"
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="text-[14px] text-fg-subtle transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg"
          >
            ×
          </button>
        </div>
        <div className="space-y-4 text-[12px]">
          <ShortcutGroup title="Global">
            <ShortcutRow k="⌃⌘N" label="Add a new task" />
            <ShortcutRow k="⇧D" label="Toggle dark / light theme" />
            <ShortcutRow k="?" label="Toggle this help" />
            <ShortcutRow k="Esc" label="Close overlays / forms" />
          </ShortcutGroup>
          <ShortcutGroup title="Task row (tab into the row first)">
            <ShortcutRow k="d" label="Mark done / undone" />
            <ShortcutRow k="t" label="Reschedule to today" />
            <ShortcutRow k="m" label="Move to tomorrow" />
            <ShortcutRow k="w" label="Push out 1 week" />
            <ShortcutRow k="e" label="Show / hide details" />
          </ShortcutGroup>
        </div>
      </div>
    </div>
  );
}

function ShortcutGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ShortcutRow({ k, label }: { k: string; label: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <kbd className="shrink-0 rounded border border-border bg-bg px-1.5 py-px font-mono text-[11px] text-fg-muted">
        {k}
      </kbd>
      <span className="text-fg-muted">{label}</span>
    </div>
  );
}
