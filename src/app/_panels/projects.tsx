"use client";

import { categoryDot, cn, shortCategoryLabel } from "@/lib/utils";
import type { Project, ProjectGroups } from "@/lib/dashboard-data";
import { useState } from "react";
import { SectionHeader } from "./section-header";

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-border">
      <div className="h-full bg-fg-muted" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ProjectRow({ p }: { p: Project }) {
  const dot = categoryDot(p.categoryTitle);
  const cat = shortCategoryLabel(p.categoryTitle);
  const fallbackSubtask = [...p.subtasks]
    .filter((s) => !s.done)
    .sort((a, b) => {
      if (a.inProgress !== b.inProgress) return a.inProgress ? -1 : 1;
      const at = (a.date ?? a.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bt = (b.date ?? b.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (at !== bt) return at - bt;
      return a.title.localeCompare(b.title);
    })[0];
  const nextStep = p.keyNextStep ?? fallbackSubtask?.title ?? null;
  return (
    <li className="px-5 py-2.5">
      <div className="flex items-center gap-2.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: dot }}
        />
        <span className="truncate text-[13.5px] font-medium">{p.title}</span>
        {cat && (
          <span className="text-[10px] tracking-[0.14em] text-fg-subtle">{cat}</span>
        )}
        <span className="ml-auto flex shrink-0 items-baseline gap-3 text-[11px] text-fg-muted">
          {p.openSubtasks > 0 && (
            <span className="tabular-nums">
              {p.openSubtasks} open
            </span>
          )}
          {p.daysSinceUpdate != null && (
            <span className="tabular-nums">{p.daysSinceUpdate}d</span>
          )}
        </span>
      </div>
      <div className="mt-1.5 ml-[18px] flex items-center gap-3">
        {nextStep ? (
          <span className="truncate text-[12px] text-fg-muted">
            <span className="text-fg-subtle">→</span> {nextStep}
          </span>
        ) : (
          <span className="text-[12px] text-fg-subtle">No next step</span>
        )}
        <span className="ml-auto w-[60px] shrink-0">
          <ProgressBar done={p.doneSubtasks} total={p.totalSubtasks} />
        </span>
        <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-fg-subtle">
          {p.totalSubtasks > 0 ? `${p.doneSubtasks * 10 + (p.totalSubtasks - p.doneSubtasks) * 5}` : "—"}
        </span>
      </div>
    </li>
  );
}

function Tab({
  label,
  count,
  active,
}: {
  label: string;
  count: number;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 rounded-md px-2 py-1 text-[12px]",
        active ? "bg-pill-bg text-fg" : "text-fg-muted",
      )}
    >
      {label}
      <span className="tabular-nums text-fg-subtle">{count}</span>
    </span>
  );
}

export function Projects({ groups }: { groups: ProjectGroups }) {
  const [view, setView] = useState<"focus" | "all">("focus");
  const list = view === "focus" ? groups.focus : groups.all;
  return (
    <section className="border-t border-border">
      <SectionHeader eyebrow="Projects" title="" count={groups.all.length} source="notion" />

      <div className="flex items-center gap-1 px-5 pb-2">
        <button
          onClick={() => setView("focus")}
          type="button"
          aria-pressed={view === "focus"}
          className="rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted/40"
        >
          <Tab label="Focus" count={groups.focus.length} active={view === "focus"} />
        </button>
        <button
          onClick={() => setView("all")}
          type="button"
          aria-pressed={view === "all"}
          className="rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted/40"
        >
          <Tab label="All" count={groups.all.length} active={view === "all"} />
        </button>
      </div>

      {list.length === 0 ? (
        <div className="px-5 pb-5 text-[12px] text-fg-subtle">
          {view === "focus" ? "No focused projects" : "No projects"}
        </div>
      ) : (
        <ul>
          {list.slice(0, 8).map((p) => (
            <ProjectRow key={p.id} p={p} />
          ))}
        </ul>
      )}
    </section>
  );
}
