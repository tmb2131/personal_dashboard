import { cn, formatTimeWithSuffix } from "@/lib/utils";
import type { CalendarEvent } from "@/lib/dashboard-data";
import { SectionHeader } from "./section-header";

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
            return (
              <div
                key={e.id}
                className={cn(
                  "absolute left-9 right-0 z-10 rounded border bg-bg-elevated px-2 py-1 text-[12px] leading-tight",
                  "border-border-strong transition-shadow duration-200 ease-out motion-reduce:duration-0 hover:z-20 hover:shadow-sm",
                )}
                style={{ top, height }}
                title={e.summary ?? ""}
              >
                <div className="truncate text-fg">{e.summary ?? "(no title)"}</div>
                {showRange && (
                  <div className="truncate text-[10px] text-fg-subtle tabular-nums">
                    {formatTimeWithSuffix(start)}–{formatTimeWithSuffix(end)}
                    {e.location ? ` · ${e.location}` : ""}
                  </div>
                )}
              </div>
            );
          })}

          {todayEvents.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-subtle">
              No events today
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
