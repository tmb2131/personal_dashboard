"use client";

import { useEffect, useState } from "react";
import { formatTimeWithSuffix } from "@/lib/utils";
import type { DashboardMeta } from "@/lib/dashboard-data";
import { ManualSyncButton } from "./manual-sync-button";
import { useTodayRecurringTasksVisibility } from "./today-recurring-tasks-context";

function pluralise(n: number, one: string, many: string) {
  return n === 1 ? `${n} ${one}` : `${n} ${many}`;
}

export function HeroHeader({ meta, initialNow }: { meta: DashboardMeta; initialNow: Date }) {
  const [now, setNow] = useState<Date>(new Date(initialNow));
  const { showRecurringTodayTasks } = useTodayRecurringTasksVisibility();

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(i);
  }, []);

  const todayOpenDisplayed =
    meta.todayOpenCount + (showRecurringTodayTasks ? meta.todayOpenRecurringCount : 0);

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
      </div>

      <div className="ml-auto hidden items-center gap-3 text-[13px] sm:flex">
        <ManualSyncButton variant="icon" className="mr-1" />
        <span className="tabular-nums text-fg-muted">{timeStr}</span>
        <SourcePill label="Calendar" />
        <SourcePill label="Notion" />
        <SourcePill label="Todoist" />
      </div>
    </header>
  );
}

function SourcePill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-pill-bg px-2.5 py-0.5 text-[11px] text-pill-fg transition-opacity duration-200 ease-out motion-reduce:duration-0 hover:opacity-90">
      <span className="h-1.5 w-1.5 rounded-full bg-done" />
      {label}
    </span>
  );
}
