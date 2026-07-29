"use client";

import { useEffect, useState } from "react";
import { cn, formatTimeWithSuffix } from "@/lib/utils";
import type { CalendarEvent } from "@/lib/dashboard-data";
import { isAllDaySpan, layoutDayEvents } from "@/lib/calendar-layout";
import { extractCalendarHtmlLink, extractMeetingUrl } from "@/lib/meeting-url";
import { SectionHeader } from "./section-header";

const GCAL_DAY_URL = "https://calendar.google.com/calendar/u/0/r/day";

const HOUR_PX = 34;
const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 23;
const MIN_EVENT_PX = 22;

function hourLabel(h: number): string {
  if (h === 12) return "12p";
  if (h === 0 || h === 24) return "12a";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function TodayCalendar({
  events,
  initialNow,
}: {
  events: CalendarEvent[];
  initialNow: Date;
}) {
  const [now, setNow] = useState<Date>(() => new Date(initialNow));

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(i);
  }, []);

  const todays = events.filter((e) => e.start && sameDay(new Date(e.start), now));

  const allDay = todays.filter(
    (e) => e.allDay || isAllDaySpan(new Date(e.start!), e.end ? new Date(e.end) : null),
  );
  const timed = todays.filter((e) => !allDay.includes(e));

  const laidOut = layoutDayEvents(
    timed.map((e) => {
      const start = new Date(e.start!);
      const end = e.end ? new Date(e.end) : new Date(start.getTime() + 30 * 60_000);
      return { event: e, start, end: end > start ? end : new Date(start.getTime() + 30 * 60_000) };
    }),
  );

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  /** Hours since midnight, so an event running to or past midnight reads as 24
   *  rather than wrapping to 0 and overflowing the grid. */
  const hoursFromMidnight = (d: Date) =>
    Math.min(24, (d.getTime() - midnight.getTime()) / 3_600_000);

  // Widen the window so nothing early or late gets clamped onto an edge.
  const startHour = Math.min(
    DEFAULT_START_HOUR,
    ...laidOut.map((l) => Math.floor(hoursFromMidnight(l.start))),
  );
  const endHour = Math.max(
    DEFAULT_END_HOUR,
    ...laidOut.map((l) => Math.ceil(hoursFromMidnight(l.end))),
  );
  const visibleHours = Math.max(1, endHour - startHour);

  const dayStart = new Date(now);
  dayStart.setHours(startHour, 0, 0, 0);

  const offsetPx = (d: Date) => ((d.getTime() - dayStart.getTime()) / 3_600_000) * HOUR_PX;

  const nowOffset = offsetPx(now);
  const showNow = nowOffset >= 0 && nowOffset <= visibleHours * HOUR_PX;

  return (
    <section id="today-schedule" className="border-t border-border scroll-mt-6">
      <SectionHeader
        eyebrow="Today"
        title="Schedule"
        count={todays.length || ""}
        source="google cal"
        sourceKey="gcal"
      />

      <div className="px-4 pb-4 sm:px-5">
        {allDay.length > 0 && (
          <ul className="mb-2 space-y-1">
            {allDay.map((e) => (
              <li
                key={e.id}
                className="flex items-baseline gap-2 rounded border border-border bg-bg-elevated px-2 py-1 text-[12px]"
              >
                <span className="shrink-0 text-[10px] tracking-[0.14em] text-fg-subtle uppercase">
                  All day
                </span>
                <span className="min-w-0 truncate text-fg">{e.summary ?? "(no title)"}</span>
              </li>
            ))}
          </ul>
        )}

        {todays.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-10 text-[12px]">
            <span className="font-serif text-fg-muted italic">A clear schedule.</span>
            <a
              href={GCAL_DAY_URL}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-fg-subtle underline decoration-dotted underline-offset-2 hover:text-fg"
            >
              Open Google Calendar →
            </a>
          </div>
        ) : (
          <div className="relative" style={{ height: visibleHours * HOUR_PX }}>
            {Array.from({ length: visibleHours + 1 }).map((_, i) => {
              const hour = startHour + i;
              return (
                <div
                  key={hour}
                  className="absolute right-0 left-0 flex items-center"
                  style={{ top: i * HOUR_PX }}
                >
                  <span className="w-7 pr-2 text-right text-[10px] tabular-nums text-fg-subtle">
                    {hourLabel(hour)}
                  </span>
                  <div className="flex-1 border-t border-border" />
                </div>
              );
            })}

            {showNow && (
              <div
                className="now-line pointer-events-none absolute right-0 left-7 z-20 flex items-center"
                style={{ top: nowOffset }}
                aria-hidden
              >
                <div className="-ml-1 h-1.5 w-1.5 rounded-full bg-danger" />
                <div className="h-px flex-1 bg-danger" />
              </div>
            )}

            {laidOut.map(({ event: e, start, end, column, columns }) => {
              const gridPx = visibleHours * HOUR_PX;
              const top = Math.max(0, Math.min(offsetPx(start), gridPx - MIN_EVENT_PX));
              // Keep an event that runs past the window inside the grid.
              const bottom = Math.min(offsetPx(end), gridPx);
              const height = Math.max(MIN_EVENT_PX, bottom - top - 2);
              const showRange = (end.getTime() - start.getTime()) / 60_000 >= 45;
              const meetingUrl = extractMeetingUrl(e);
              const calendarUrl = extractCalendarHtmlLink(e);
              const href = meetingUrl ?? calendarUrl;

              // Share the track between concurrent events instead of stacking them.
              const widthPct = 100 / columns;
              const cardClass = cn(
                "absolute z-10 overflow-hidden rounded border bg-bg-elevated px-2 py-1 text-[12px] leading-tight",
                "border-border-strong transition-shadow duration-200 ease-out motion-reduce:duration-0 hover:z-30 hover:shadow-sm",
                href && "cursor-pointer hover:border-fg-muted",
              );
              const style = {
                top,
                height,
                left: `calc(2.25rem + (100% - 2.25rem) * ${column / columns})`,
                width: `calc((100% - 2.25rem) * ${widthPct / 100} - 2px)`,
              };
              const titleAttr = [
                meetingUrl ? "Join meeting" : calendarUrl ? "Open in Google Calendar" : null,
                e.summary ?? "",
                `${formatTimeWithSuffix(start)}–${formatTimeWithSuffix(end)}`,
              ]
                .filter(Boolean)
                .join(" · ");
              const inner = (
                <>
                  <div className="flex items-baseline gap-1 truncate text-fg">
                    <span className="truncate">{e.summary ?? "(no title)"}</span>
                    {meetingUrl && (
                      <span aria-hidden className="shrink-0 text-[10px] text-accent">
                        ↗
                      </span>
                    )}
                  </div>
                  {showRange && (
                    <div className="truncate text-[10px] tabular-nums text-fg-subtle">
                      {formatTimeWithSuffix(start)}–{formatTimeWithSuffix(end)}
                      {e.location ? ` · ${e.location}` : ""}
                    </div>
                  )}
                </>
              );

              return href ? (
                <a
                  key={e.id}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className={cardClass}
                  style={style}
                  title={titleAttr}
                >
                  {inner}
                </a>
              ) : (
                <div key={e.id} className={cardClass} style={style} title={titleAttr}>
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
