import type { Project } from "@/lib/dashboard-data";
import { daysUntil } from "@/lib/dashboard-data";
import { SectionHeader } from "./section-header";

function formatDayMonth(d: Date): string {
  return d
    .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    .replace(".", "");
}

function durationDays(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return days >= 0 ? days : null;
}

export function UpcomingTrips({ trips, now }: { trips: Project[]; now: Date }) {
  return (
    <section className="border-t border-border">
      <SectionHeader eyebrow="Upcoming Trips" title="" count={trips.length} source="notion" />

      {trips.length === 0 ? (
        <div className="px-5 pb-5 text-[12px] text-fg-subtle">Nothing on the horizon</div>
      ) : (
        <ul>
          {trips.map((t) => {
            const days = t.dateStart ? Math.max(0, daysUntil(t.dateStart, now)) : null;
            const dur = durationDays(t.dateStart, t.dateEnd);
            const isPlanning = t.tripStatus === "Idea" || t.tripStatus === "Planned";
            const isBooked = t.tripStatus === "Booked";
            return (
              <li key={t.id} className="flex items-start gap-4 px-5 py-3">
                <div className="w-12 shrink-0 text-right">
                  <div className="text-[26px] font-medium leading-none tabular-nums">
                    {days ?? "—"}
                  </div>
                  <div className="mt-1 text-[10px] tracking-[0.14em] text-fg-subtle">
                    DAYS
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-[14px] font-medium">{t.title}</span>
                    {isBooked && <Pill>BOOKED</Pill>}
                    {isPlanning && !isBooked && <Pill>PLANNING</Pill>}
                  </div>
                  <div className="mt-1 flex items-baseline gap-2 text-[12px] text-fg-muted tabular-nums">
                    {t.dateStart && <span>{formatDayMonth(t.dateStart)}</span>}
                    {t.dateEnd && t.dateStart && (
                      <>
                        <span>→</span>
                        <span>{formatDayMonth(t.dateEnd)}</span>
                      </>
                    )}
                    {dur != null && <span>· {dur}d</span>}
                  </div>
                  {t.keyNextStep && (
                    <div className="mt-1 truncate font-serif italic text-[12px] text-fg-muted">
                      {t.keyNextStep}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto inline-flex items-center rounded bg-pill-bg px-1.5 py-0.5 text-[10px] tracking-[0.14em] text-pill-fg">
      {children}
    </span>
  );
}
