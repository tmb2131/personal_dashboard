import { formatTimeWithSuffix } from "@/lib/utils";
import type { DayGroupedEvents } from "@/lib/dashboard-data";
import { SectionHeader } from "./section-header";

function locationFor(e: DayGroupedEvents["events"][number]): string {
  if (e.location) return e.location;
  // Fall back to conferencing hint embedded in summary
  return "";
}

export function Next3Days({ groups }: { groups: DayGroupedEvents[] }) {
  const total = groups.reduce((n, g) => n + g.events.length, 0);

  return (
    <section className="border-t border-border">
      <SectionHeader eyebrow="Next 3 Days" title="" count={total} source="google cal" />

      <div className="px-5 pb-5">
        {groups.map((g) => (
          <div key={g.bucket.key} className="mb-4 last:mb-0">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-[14px] font-medium">{g.bucket.label}</span>
              <span className="font-serif italic text-[12px] text-fg-muted">
                {g.bucket.monthLabel}
              </span>
              <span className="ml-auto text-[11px] tabular-nums text-fg-subtle">
                {g.events.length}
              </span>
            </div>

            {g.events.length === 0 ? (
              <div className="pl-2 text-[12px] text-fg-subtle">No events</div>
            ) : (
              <ul className="space-y-1.5">
                {g.events.map((e) => {
                  const start = e.start ? new Date(e.start) : null;
                  const loc = locationFor(e);
                  return (
                    <li
                      key={e.id}
                      className="flex items-baseline gap-3 text-[13px]"
                    >
                      <span className="w-12 shrink-0 tabular-nums text-fg-muted">
                        {start ? formatTimeWithSuffix(start) : ""}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{e.summary ?? "(no title)"}</span>
                      {loc && (
                        <span className="ml-2 shrink-0 truncate text-[11px] text-fg-subtle">
                          {loc}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
