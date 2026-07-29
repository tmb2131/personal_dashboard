"use client";

import { useEffect, useState } from "react";
import { cn, formatTimeWithSuffix } from "@/lib/utils";
import type { DashboardMeta, SourceHealth } from "@/lib/dashboard-data";
import { dotClassFor, formatAgo, freshnessFor, type Freshness } from "@/lib/freshness";
import { ManualSyncButton } from "./manual-sync-button";
import { SignOutButton } from "./sign-out-button";
import { useSyncStatus } from "./sync-status-context";
import { ThemeToggleButton } from "./theme-toggle-button";
import { useTodayRecurringTasksVisibility } from "./today-recurring-tasks-context";

function pluralise(n: number, one: string, many: string) {
  return n === 1 ? `${n} ${one}` : `${n} ${many}`;
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
  const overdueDisplayed =
    meta.overdueOpenCount + (showRecurringTodayTasks ? meta.overdueOpenRecurringCount : 0);

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
          <ThemeToggleButton variant="icon" />
          <SignOutButton />
          <ManualSyncButton variant="icon" />
          <span className="tabular-nums text-fg-muted">{timeStr}</span>
          {/* Sync failures were previously invisible on phones. */}
          <SourceHealthGroup
            sources={meta.sources}
            errorBySource={errorBySource}
            inFlight={inFlight}
            now={now}
          />
        </div>
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] tabular-nums text-fg-muted sm:mt-0 sm:ml-2">
        <span>{pluralise(todayOpenDisplayed, "open", "open")}</span>
        {overdueDisplayed > 0 && (
          <>
            <span className="text-fg-subtle">·</span>
            <span className="text-danger">{overdueDisplayed} overdue</span>
          </>
        )}
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
        <SignOutButton />
        <ManualSyncButton variant="icon" className="mr-1" />
        <span className="tabular-nums text-fg-muted">{timeStr}</span>
        <SourceHealthGroup
          sources={meta.sources}
          errorBySource={errorBySource}
          inFlight={inFlight}
          now={now}
        />
      </div>
    </header>
  );
}

const FRESHNESS_RANK: Record<Freshness, number> = {
  fresh: 0,
  recent: 1,
  unknown: 2,
  stale: 3,
};

type SourceItem = {
  key: "gcal" | "notion" | "todoist";
  label: string;
  health: SourceHealth;
  error?: string;
};

function SourceHealthGroup({
  sources,
  errorBySource,
  inFlight,
  now,
}: {
  sources: DashboardMeta["sources"];
  errorBySource: { gcal?: string; notion?: string; todoist?: string };
  inFlight: boolean;
  now: Date;
}) {
  const items: SourceItem[] = [
    { key: "gcal", label: "Calendar", health: sources.gcal, error: errorBySource.gcal },
    { key: "notion", label: "Notion", health: sources.notion, error: errorBySource.notion },
    { key: "todoist", label: "Todoist", health: sources.todoist, error: errorBySource.todoist },
  ];
  const rank = (item: SourceItem) =>
    item.error ? 99 : FRESHNESS_RANK[freshnessFor(item.health, now)];
  const worst = items.reduce((a, b) => (rank(b) > rank(a) ? b : a), items[0]);
  const worstHasError = Boolean(worst.error);
  const worstDot = dotClassFor(freshnessFor(worst.health, now), worstHasError);
  const oldest =
    items
      .map((i) => i.health.lastSyncAt)
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const agoLabel = formatAgo(oldest, now);
  const anyError = items.some((i) => i.error);
  const errored = items.filter((i) => i.error);
  const summaryLabel = anyError
    ? `Sync error: ${errored.map((i) => i.label).join(", ")}`
    : `All sources synced — ${agoLabel}`;

  return (
    <details className="group relative border-l border-border pl-3">
      <summary
        aria-label={summaryLabel}
        className={cn(
          "inline-flex cursor-pointer list-none items-center gap-1.5 text-[11px] tabular-nums text-fg-muted",
          "[&::-webkit-details-marker]:hidden",
          "transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 rounded-sm",
          anyError && "text-danger",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            worstDot,
            inFlight && "motion-safe:animate-pulse",
          )}
        />
        <span>{agoLabel}</span>
      </summary>
      <div
        role="group"
        aria-label="Sync status by source"
        className="absolute right-0 z-20 mt-2 w-56 rounded-md border border-border-strong bg-bg-elevated p-2 text-[11px]"
      >
        {items.map((item) => {
          const fresh = freshnessFor(item.health, now);
          const has = Boolean(item.error);
          return (
            <div key={item.key} className="py-0.5">
              <div className="flex items-center gap-2">
                <span className={cn("h-1.5 w-1.5 rounded-full", dotClassFor(fresh, has))} />
                <span className={cn("text-fg", has && "text-danger")}>{item.label}</span>
                <span className="ml-auto tabular-nums text-fg-subtle">
                  {formatAgo(item.health.lastSyncAt, now)}
                </span>
              </div>
              {has ? (
                <div className="mt-0.5 pl-3.5 text-danger">{item.error}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </details>
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
