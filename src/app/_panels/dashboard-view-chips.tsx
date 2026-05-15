"use client";

import { cn } from "@/lib/utils";
import { useDashboardView, VIEWS } from "./dashboard-view-context";

export function DashboardViewChips() {
  const { activeView, setActiveView } = useDashboardView();

  return (
    <nav className="border-t border-border px-4 py-2 sm:px-8" aria-label="Dashboard views">
      <div className="flex gap-1 overflow-x-auto pb-1 sm:inline-flex sm:overflow-visible sm:pb-0">
        {VIEWS.map((view) => {
          const isActive = activeView === view.id;
          return (
            <button
              key={view.id}
              type="button"
              onClick={() => setActiveView(view.id)}
              aria-pressed={isActive}
              className={cn(
                "shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] text-fg-muted",
                "transition-[color,box-shadow,background-color,border-color] duration-200 ease-out motion-reduce:duration-0",
                "hover:bg-bg-elevated/60 hover:text-fg",
                "focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:outline-none",
                "motion-safe:active:scale-[0.98]",
                isActive &&
                  "border-border-strong bg-bg-elevated text-fg shadow-sm hover:bg-bg-elevated",
              )}
            >
              {view.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
