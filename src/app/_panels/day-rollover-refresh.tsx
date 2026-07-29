"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { formatDateOnlyLocal, msUntilNextLocalMidnight } from "@/lib/date-utils";

/**
 * Re-renders the dashboard when the local date rolls over.
 *
 * Today / Overdue / Next 3 Days are bucketed server-side from the `now` of the
 * render that produced this payload, while the header and footer clocks tick on
 * their own. Without this, a tab left open overnight shows the new date above
 * yesterday's task buckets.
 */
export function DayRolloverRefresh({ now }: { now: Date }) {
  const router = useRouter();
  const renderedDayKey = formatDateOnlyLocal(new Date(now));

  const refreshIfDayChanged = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    if (formatDateOnlyLocal(new Date()) === renderedDayKey) return;
    router.refresh();
  }, [router, renderedDayKey]);

  useEffect(() => {
    let timer: number | null = null;

    const armMidnightTimer = () => {
      timer = window.setTimeout(() => {
        timer = null;
        refreshIfDayChanged();
        // Re-arm even when the refresh was skipped (hidden tab), so a tab that
        // stays open for several days keeps checking.
        armMidnightTimer();
      }, msUntilNextLocalMidnight(new Date()));
    };

    // Background tabs throttle timers, so a tab woken from overnight sleep gets
    // its rollover from this listener rather than the timer above.
    document.addEventListener("visibilitychange", refreshIfDayChanged);
    refreshIfDayChanged();
    armMidnightTimer();

    return () => {
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshIfDayChanged);
    };
  }, [refreshIfDayChanged]);

  return null;
}
