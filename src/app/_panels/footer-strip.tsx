"use client";

import { useEffect, useState } from "react";
import { isEditableTarget } from "@/lib/utils";
import { ManualSyncButton } from "./manual-sync-button";

function relativeAgo(d: Date | null, now: Date): string {
  if (!d) return "never";
  const ms = now.getTime() - d.getTime();
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function FooterStrip({
  initialNow,
  lastSyncAt,
}: {
  initialNow: Date;
  lastSyncAt: Date | null;
}) {
  const [now, setNow] = useState<Date>(new Date(initialNow));
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const stored = window.localStorage.getItem("dashboard-theme");
    if (stored === "dark" || stored === "light") {
      html.classList.toggle("theme-dark", stored === "dark");
      html.classList.toggle("theme-light", stored === "light");
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isEditableTarget(e.target)) return;
      if (e.ctrlKey && e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const isDark = html.classList.contains("theme-dark");
        const next = isDark ? "light" : "dark";
        html.classList.toggle("theme-dark", next === "dark");
        html.classList.toggle("theme-light", next === "light");
        window.localStorage.setItem("dashboard-theme", next);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const dateLabel = now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-8 py-3 text-[11px] text-fg-subtle">
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          Synced <span className="tabular-nums">{relativeAgo(lastSyncAt, now)}</span>
        </span>
        <ManualSyncButton size="sm" />
      </span>
      <span>·</span>
      <KeyHint k="⌃⌘N" label="new task" />
      <KeyHint k="⌃⌘D" label="dark/light" />

      <span className="ml-auto font-serif italic text-fg-muted">{dateLabel}</span>
    </footer>
  );
}

function KeyHint({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="rounded border border-border bg-bg-elevated px-1.5 py-px font-mono text-[10px] text-fg-muted">
        {k}
      </kbd>
      <span>{label}</span>
    </span>
  );
}
