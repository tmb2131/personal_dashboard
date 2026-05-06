"use client";

import { useEffect, useState } from "react";

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

  const dateLabel = now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <footer className="flex items-center gap-4 border-t border-border px-8 py-3 text-[11px] text-fg-subtle">
      <span>
        Synced <span className="tabular-nums">{relativeAgo(lastSyncAt, now)}</span>
      </span>
      <span>·</span>
      <KeyHint k="⌘K" label="jump" />
      <KeyHint k="N" label="new task" />
      <KeyHint k="D" label="dark" />

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
