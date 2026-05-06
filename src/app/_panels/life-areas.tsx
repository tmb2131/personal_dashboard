import type { Project } from "@/lib/dashboard-data";
import { SectionHeader } from "./section-header";

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-border">
      <div className="h-full bg-fg-muted" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function LifeAreas({ areas }: { areas: Project[] }) {
  return (
    <section className="border-t border-border">
      <SectionHeader eyebrow="Life Areas" title="" count={areas.length} source="notion" />

      {areas.length === 0 ? (
        <div className="px-5 pb-5 text-[12px] text-fg-subtle">None marked</div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 pb-5">
          {areas.map((a) => {
            const motto = a.keyNextStep ?? a.notes;
            return (
              <div key={a.id} className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[14px] font-medium">{a.title}</span>
                  <span className="ml-auto text-[10px] tabular-nums text-fg-subtle">
                    {a.daysSinceUpdate ?? 0}d
                  </span>
                </div>
                {motto && (
                  <div className="mt-0.5 truncate font-serif italic text-[12px] text-fg-muted">
                    {motto}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <span className="flex-1">
                    <ProgressBar done={a.doneSubtasks} total={a.totalSubtasks} />
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-fg-subtle">
                    {a.doneSubtasks}/{a.totalSubtasks || 0}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
