"use client";

import { useEffect, useState } from "react";
import { ManualSyncButton } from "./manual-sync-button";

type Theme = "dark" | "light";

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

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  html.classList.toggle("theme-dark", theme === "dark");
  html.classList.toggle("theme-light", theme === "light");
  window.localStorage.setItem("dashboard-theme", theme);
}

function currentTheme(): Theme {
  const html = document.documentElement;
  if (html.classList.contains("theme-dark")) return "dark";
  if (html.classList.contains("theme-light")) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function toggleTheme() {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
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
    const stored = window.localStorage.getItem("dashboard-theme");
    if (stored === "dark" || stored === "light") {
      applyTheme(stored);
    }
  }, []);

  const dateLabel = now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <footer
      id="review-strip"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-8 py-3 pb-20 text-[11px] text-fg-subtle sm:pb-3"
    >
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          Synced <span className="tabular-nums">{relativeAgo(lastSyncAt, now)}</span>
        </span>
        <ManualSyncButton size="sm" />
      </span>
      <span>·</span>
      <KeyHint k="⌃⌘N" label="new task" />
      <ThemeToggle label="dark/light" onClick={toggleTheme} />

      <span className="ml-auto font-serif italic text-fg-muted">{dateLabel}</span>
    </footer>
  );
}

function ThemeToggle({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm text-fg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {label}
    </button>
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
