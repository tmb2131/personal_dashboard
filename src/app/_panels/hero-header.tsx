"use client";

import { useEffect, useState } from "react";
import { cn, formatTimeWithSuffix } from "@/lib/utils";
import type { DashboardMeta, SourceHealth } from "@/lib/dashboard-data";
import { ManualSyncButton } from "./manual-sync-button";
import { useSyncStatus } from "./sync-status-context";
import { useTodayRecurringTasksVisibility } from "./today-recurring-tasks-context";

function pluralise(n: number, one: string, many: string) {
  return n === 1 ? `${n} ${one}` : `${n} ${many}`;
}

type Freshness = "fresh" | "recent" | "stale" | "unknown";

function freshnessFor(health: SourceHealth, now: Date): Freshness {
  if (!health.lastSyncAt) return "unknown";
  const minutes = (now.getTime() - health.lastSyncAt.getTime()) / 60_000;
  if (minutes < 5) return "fresh";
  if (minutes < 30) return "recent";
  return "stale";
}

function dotClassFor(freshness: Freshness, hasError: boolean): string {
  if (hasError) return "bg-red-500";
  if (freshness === "fresh") return "bg-done";
  if (freshness === "recent") return "bg-done/60";
  if (freshness === "stale") return "bg-amber-400/80";
  return "bg-fg-subtle/40";
}

function formatAgo(d: Date | null, now: Date): string {
  if (!d) return "never synced";
  const ms = now.getTime() - d.getTime();
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 1) return "just synced";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function HeroHeader({ meta, initialNow }: { meta: DashboardMeta; initialNow: Date }) {
  const [now, setNow] = useState<Date>(new Date(initialNow));
  const { showRecurringTodayTasks } = useTodayRecurringTasksVisibility();
  const { inFlight, errorBySource } = useSyncStatus();

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(i);
  }, []);

  const todayOpenDisplayed =
    meta.todayOpenCount + (showRecurringTodayTasks ? meta.todayOpenRecurringCount : 0);

  const flash = useUpdateFlash({
    open: todayOpenDisplayed,
    meetings: meta.todayMeetingCount,
  });

  const weekday = now.toLocaleDateString("en-GB", { weekday: "long" });
  const dayMonth = now.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <header className="px-4 pt-5 pb-4 sm:flex sm:items-baseline sm:gap-6 sm:px-8 sm:pt-6 sm:pb-5">
      <div className="flex min-w-0 items-start justify-between gap-3 sm:contents">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h1 className="text-[28px] leading-none font-medium tracking-tight">{weekday},</h1>
          <span className="whitespace-nowrap font-serif text-[26px] text-fg-muted italic">{dayMonth}</span>
        </div>

        <div className="flex shrink-0 items-center gap-2 pt-0.5 text-[13px] sm:hidden">
          <ManualSyncButton variant="icon" />
          <span className="tabular-nums text-fg-muted">{timeStr}</span>
        </div>
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-fg-muted sm:mt-0 sm:ml-2">
        <span>{pluralise(todayOpenDisplayed, "open", "open")}</span>
        <span className="text-fg-subtle">·</span>
        <span>{pluralise(meta.todayMeetingCount, "meeting", "meetings")}</span>
        {meta.nextEvent && (
          <>
            <span className="text-fg-subtle">·</span>
            <span className="min-w-0 max-w-full">
              next{" "}
              <span className="break-words text-fg">{meta.nextEvent.summary}</span>{" "}
              at{" "}
              <span className="tabular-nums text-fg">
                {formatTimeWithSuffix(meta.nextEvent.start)}
              </span>
            </span>
          </>
        )}
        {flash && (
          <span
            aria-live="polite"
            className="inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-2 py-px text-[11px] tabular-nums text-fg motion-safe:animate-[fade-in_200ms_ease-out]"
          >
            {flash}
          </span>
        )}
      </div>

      <div className="ml-auto hidden items-center gap-3 text-[13px] sm:flex">
        <ManualSyncButton variant="icon" className="mr-1" />
        <span className="tabular-nums text-fg-muted">{timeStr}</span>
        <SourcePill
          label="Calendar"
          health={meta.sources.gcal}
          inFlight={inFlight}
          error={errorBySource.gcal}
          now={now}
        />
        <SourcePill
          label="Notion"
          health={meta.sources.notion}
          inFlight={inFlight}
          error={errorBySource.notion}
          now={now}
        />
        <SourcePill
          label="Todoist"
          health={meta.sources.todoist}
          inFlight={inFlight}
          error={errorBySource.todoist}
          now={now}
        />
      </div>
    </header>
  );
}

function SourcePill({
  label,
  health,
  inFlight,
  error,
  now,
}: {
  label: string;
  health: SourceHealth;
  inFlight: boolean;
  error?: string;
  now: Date;
}) {
  const fresh = freshnessFor(health, now);
  const hasError = Boolean(error);
  const dotClass = dotClassFor(fresh, hasError);
  const ago = formatAgo(health.lastSyncAt, now);
  const title = hasError ? `${label}: ${error}` : `${label} · ${ago}`;
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-pill-bg px-2.5 py-0.5 text-[11px] text-pill-fg transition-opacity duration-200 ease-out motion-reduce:duration-0 hover:opacity-90",
        hasError && "text-red-300",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          dotClass,
          inFlight && "motion-safe:animate-pulse",
        )}
      />
      {label}
    </span>
  );
}

function useUpdateFlash(counts: { open: number; meetings: number }) {
  // Detect prop deltas during render and stage the flash text — see
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [message, setMessage] = useState<string | null>(null);
  const [seen, setSeen] = useState(counts);
  if (counts.open !== seen.open || counts.meetings !== seen.meetings) {
    const parts: string[] = [];
    if (counts.open > seen.open) {
      const delta = counts.open - seen.open;
      parts.push(`+${delta} task${delta === 1 ? "" : "s"}`);
    }
    if (counts.meetings > seen.meetings) {
      const delta = counts.meetings - seen.meetings;
      parts.push(`+${delta} event${delta === 1 ? "" : "s"}`);
    }
    setSeen(counts);
    setMessage(parts.length > 0 ? parts.join(", ") : null);
  }

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(t);
  }, [message]);

  return message;
}
