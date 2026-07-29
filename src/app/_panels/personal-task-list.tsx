"use client";

import { useState } from "react";
import type { Subtask } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";
import { dispatchShortcut, EmptyState } from "./empty-state";
import { SectionHeader } from "./section-header";
import { TaskRow } from "./task-row";

type PersonalTaskView = "personal" | "next7Days";

export function PersonalTaskList({
  tasks,
  next7DaysTasks,
  defaultView = "personal",
}: {
  tasks: Subtask[];
  next7DaysTasks: Subtask[];
  defaultView?: PersonalTaskView;
}) {
  const [view, setView] = useState<PersonalTaskView>(defaultView);
  const visibleTasks = view === "personal" ? tasks : next7DaysTasks;
  const taskContext = (t: Subtask) => {
    if (t.projectTitle) return `Notion: ${t.projectTitle}`;
    if (!t.categoryTitle) return null;
    if (view === "personal" && t.categoryTitle.trim().toLowerCase() === "personal") return null;
    return `Todoist: ${t.categoryTitle}`;
  };

  return (
    <section id="personal-tasks" className="border-t border-border scroll-mt-6">
      <SectionHeader
        eyebrow="Personal"
        title="Tasks"
        count={visibleTasks.length}
        source={view === "personal" ? "todoist" : "todoist + notion"}
        sourceKey="todoist"
      >
        <div className="inline-flex rounded-full border border-border bg-bg p-0.5 text-[11px]">
          {([
            ["personal", "Personal"],
            ["next7Days", "Next 7 Days"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              aria-pressed={view === value}
              className={cn(
                "rounded-full px-2 py-0.5 text-fg-muted transition hover:text-fg",
                view === value && "bg-bg-elevated text-fg shadow-sm",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </SectionHeader>

      {visibleTasks.length === 0 ? (
        view === "personal" ? (
          <EmptyState
            message="No open Personal tasks."
            cta={{
              label: "Add a personal task",
              onClick: () => dispatchShortcut("new-task"),
            }}
          />
        ) : tasks.length > 0 ? (
          <EmptyState
            message="No open tasks due in the next 7 days."
            cta={{
              label: "Switch to Personal",
              onClick: () => setView("personal"),
            }}
          />
        ) : (
          <EmptyState
            message="No open tasks due in the next 7 days."
            cta={{
              label: "Add a task",
              onClick: () => dispatchShortcut("new-task"),
            }}
          />
        )
      ) : (
        <ul>
          {visibleTasks.map((t) => (
            <TaskRow
              key={t.key}
              t={t}
              contextLabel={taskContext(t)}
              showDueOnRight
              showUndoChip
              showCrossPost={false}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
