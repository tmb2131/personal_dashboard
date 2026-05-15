import type { SourceHealth } from "@/lib/dashboard-data";

export type Freshness = "fresh" | "recent" | "stale" | "unknown";

export function freshnessFor(health: SourceHealth, now: Date): Freshness {
  if (!health.lastSyncAt) return "unknown";
  const minutes = (now.getTime() - health.lastSyncAt.getTime()) / 60_000;
  if (minutes < 5) return "fresh";
  if (minutes < 30) return "recent";
  return "stale";
}

export function dotClassFor(freshness: Freshness, hasError: boolean): string {
  if (hasError) return "bg-red-500";
  if (freshness === "fresh") return "bg-done";
  if (freshness === "recent") return "bg-done/60";
  if (freshness === "stale") return "bg-amber-400/80";
  return "bg-fg-subtle/40";
}

export function formatAgo(d: Date | null, now: Date): string {
  if (!d) return "never synced";
  const ms = now.getTime() - d.getTime();
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 1) return "just synced";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
