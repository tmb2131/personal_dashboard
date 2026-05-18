"use client";

import type { Project } from "@/lib/dashboard-data";
import { SectionCollapseControls } from "./section-collapse-controls";
import { SectionHeader } from "./section-header";
import { useSectionVisibility } from "./section-visibility-context";

export function LifeAreas({ areas }: { areas: Project[] }) {
  const { collapsed, hidden } = useSectionVisibility("life-areas");

  if (hidden) return null;

  return (
    <section id="life-areas" className="border-t border-border scroll-mt-6">
      <SectionHeader
        eyebrow="Life Areas"
        title=""
        count={areas.length}
        source="notion"
        sourceKey="notion"
      >
        <SectionCollapseControls
          sectionId="life-areas"
          bodyId="life-areas-body"
          label="Life Areas"
        />
      </SectionHeader>

      {!collapsed &&
        (areas.length === 0 ? (
          <div id="life-areas-body" className="px-5 pb-5 text-[12px] text-fg-subtle">
            None marked
          </div>
        ) : (
          <div
            id="life-areas-body"
            className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 pb-5"
          >
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
        ))}
    </section>
  );
}
