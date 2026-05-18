"use client";

import { useEffect, useState } from "react";
import { loadStoredTheme, toggleTheme } from "@/lib/theme";
import { isEditableTarget } from "@/lib/utils";
import { HiddenSectionsMenu } from "./hidden-sections-menu";
import { ManualSyncButton } from "./manual-sync-button";
import { ReconcileButton } from "./reconcile-button";
import { useSyncStatus } from "./sync-status-context";
import { ThemeToggleButton } from "./theme-toggle-button";

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
  const { inFlight } = useSyncStatus();
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    loadStoredTheme();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.key === "D") {
        e.preventDefault();
        toggleTheme();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dateLabel = now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <footer
      id="review-strip"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-[11px] text-fg-subtle sm:px-8"
    >
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-live="polite">
          {inFlight ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
              Syncing…
            </span>
          ) : (
            <>
              Synced <span className="tabular-nums">{relativeAgo(lastSyncAt, now)}</span>
            </>
          )}
        </span>
        <ManualSyncButton size="sm" />
        <ReconcileButton />
      </span>
      <span>·</span>
      <ShortcutsHint />
      <ThemeToggleButton variant="label" />
      <HiddenSectionsMenu />

      <span className="font-serif text-fg-muted italic sm:ml-auto">{dateLabel}</span>
    </footer>
  );
}

function ShortcutsHint() {
  const openHelp = () => {
    window.dispatchEvent(
      new CustomEvent("dashboard-shortcut", { detail: { type: "help" } }),
    );
  };
  return (
    <button
      type="button"
      onClick={openHelp}
      className="inline-flex items-center gap-1.5 text-fg-subtle transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <kbd className="rounded border border-border bg-bg-elevated px-1.5 py-px font-mono text-[10px] text-fg-muted transition-colors duration-200 ease-out motion-reduce:duration-0 hover:border-border-strong">
        ?
      </kbd>
      <span>shortcuts</span>
    </button>
  );
}
