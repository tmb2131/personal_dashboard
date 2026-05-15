import { cn, formatTimeWithSuffix } from "@/lib/utils";
import type { CalendarEvent } from "@/lib/dashboard-data";
import { extractCalendarHtmlLink, extractMeetingUrl } from "@/lib/meeting-url";
import { SectionHeader } from "./section-header";

const GCAL_DAY_URL = "https://calendar.google.com/calendar/u/0/r/day";

const HOUR_PX = 28;
const START_HOUR = 7;
const END_HOUR = 23;
const VISIBLE_HOURS = END_HOUR - START_HOUR;

function clampPx(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function hourLabel(h: number): string {
  if (h === 12) return "12p";
  if (h === 0) return "12a";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

export function TodayCalendar({
  events,
  now,
}: {
  events: CalendarEvent[];
  now: Date;
}) {
  const dayStart = new Date(now);
  dayStart.setHours(START_HOUR, 0, 0, 0);

  const todayEvents = events.filter((e) => {
    if (!e.start) return false;
    const s = new Date(e.start);
    return (
      s.getDate() === now.getDate() &&
      s.getMonth() === now.getMonth() &&
      s.getFullYear() === now.getFullYear()
    );
  });

  const nowOffset =
    ((now.getHours() - START_HOUR) + now.getMinutes() / 60) * HOUR_PX;
  const showNow = now.getHours() >= START_HOUR && now.getHours() < END_HOUR;

  return (
    <section className="border-t border-border">
      <SectionHeader eyebrow="Today" title="Schedule" count={todayEvents.length || ""} source="google cal" />

      <div className="relative px-5 pb-4">
        <div className="relative" style={{ height: VISIBLE_HOURS * HOUR_PX }}>
          {Array.from({ length: VISIBLE_HOURS + 1 }).map((_, i) => {
            const hour = START_HOUR + i;
            return (
              <div
                key={hour}
                className="absolute left-0 right-0 flex items-center"
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
              className="now-line absolute left-7 right-0 z-10 flex items-center"
              style={{ top: nowOffset }}
            >
              <div className="-ml-1 h-1.5 w-1.5 rounded-full bg-red-500" />
              <div className="h-px flex-1 bg-red-500" />
            </div>
          )}

          {todayEvents.map((e) => {
            if (!e.start) return null;
            const start = new Date(e.start);
            const end = e.end ? new Date(e.end) : new Date(start.getTime() + 30 * 60_000);
            const top = clampPx(
              ((start.getTime() - dayStart.getTime()) / 3600000) * HOUR_PX,
              0,
              VISIBLE_HOURS * HOUR_PX,
            );
            const height = Math.max(
              22,
              ((end.getTime() - start.getTime()) / 3600000) * HOUR_PX - 2,
            );
            const showRange = (end.getTime() - start.getTime()) / 60_000 >= 60;
            const meetingUrl = extractMeetingUrl(e);
            const calendarUrl = extractCalendarHtmlLink(e);
            const href = meetingUrl ?? calendarUrl;
            const cardClass = cn(
              "absolute left-9 right-0 z-10 rounded border bg-bg-elevated px-2 py-1 text-[12px] leading-tight",
              "border-border-strong transition-shadow duration-200 ease-out motion-reduce:duration-0 hover:z-20 hover:shadow-sm",
              href && "cursor-pointer hover:border-fg-muted",
            );
            const inner = (
              <>
                <div className="flex items-baseline gap-1 truncate text-fg">
                  <span className="truncate">{e.summary ?? "(no title)"}</span>
                  {meetingUrl && (
                    <span aria-hidden className="shrink-0 text-[10px] text-accent">↗</span>
                  )}
                </div>
                {showRange && (
                  <div className="truncate text-[10px] text-fg-subtle tabular-nums">
                    {formatTimeWithSuffix(start)}–{formatTimeWithSuffix(end)}
                    {e.location ? ` · ${e.location}` : ""}
                  </div>
                )}
              </>
            );
            const titleAttr = meetingUrl
              ? `Join meeting · ${e.summary ?? ""}`
              : calendarUrl
              ? `Open in Google Calendar · ${e.summary ?? ""}`
              : e.summary ?? "";
            return href ? (
              <a
                key={e.id}
                href={href}
                target="_blank"
                rel="noreferrer"
                className={cardClass}
                style={{ top, height }}
                title={titleAttr}
              >
                {inner}
              </a>
            ) : (
              <div
                key={e.id}
                className={cardClass}
                style={{ top, height }}
                title={titleAttr}
              >
                {inner}
              </div>
            );
          })}

          {todayEvents.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[12px]">
              <span className="font-serif italic text-fg-muted">A clear schedule.</span>
              <a
                href={GCAL_DAY_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-fg-subtle underline decoration-dotted underline-offset-2 hover:text-fg"
              >
                Open Google Calendar →
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
