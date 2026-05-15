import type { Project } from "@/lib/dashboard-data";
import { SectionHeader } from "./section-header";

export function LifeAreas({ areas }: { areas: Project[] }) {
  return (
    <section id="life-areas" className="border-t border-border scroll-mt-6">
      <SectionHeader
        eyebrow="Life Areas"
        title=""
        count={areas.length}
        source="notion"
        sourceKey="notion"
      />

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
                </div>
                {motto && (
                  <div className="mt-0.5 truncate font-serif italic text-[12px] text-fg-muted">
                    {motto}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
