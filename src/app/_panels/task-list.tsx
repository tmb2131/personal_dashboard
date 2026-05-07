"use client";

import { useMemo } from "react";
import type { Subtask } from "@/lib/dashboard-data";
import { SectionHeader } from "./section-header";
import { TaskRow } from "./task-row";
import { AddTaskRow } from "./add-task-row";
import { useTodayRecurringTasksVisibility } from "./today-recurring-tasks-context";

export function TaskList({
  tasks,
  notionProjectPicklist,
  source = "todoist",
}: {
  tasks: Subtask[];
  notionProjectPicklist: { id: string; title: string }[];
  source?: string;
}) {
  const { showRecurringTodayTasks, setShowRecurringTodayTasks } = useTodayRecurringTasksVisibility();

  const visibleTasks = useMemo(() => {
    const recurringFiltered = showRecurringTodayTasks ? tasks : tasks.filter((t) => !t.hasRecurringTag);
    return recurringFiltered.filter((t) => !t.done);
  }, [tasks, showRecurringTodayTasks]);

  const total = visibleTasks.length;
  const ratio = total.toString();
  const isEmpty = total === 0;

  return (
    <section className="border-t border-border">
      <SectionHeader eyebrow="Today" title="Tasks" count={ratio} source={source}>
        <div className="flex cursor-default select-none items-center gap-2 text-[11px] text-fg-muted">
          <span className="max-w-[9rem] leading-snug normal-case tracking-normal">
            {showRecurringTodayTasks ? "All tasks" : "Excluding recurring-label"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={showRecurringTodayTasks}
            aria-label={
              showRecurringTodayTasks
                ? "Today list shows every task including recurring-label. Switch to exclude recurring-label tasks."
                : "Today list hides recurring-label tasks. Switch to show all tasks."
            }
            title={
              showRecurringTodayTasks
                ? "Showing all tasks (toggle to hide recurring-label tasks)"
                : "Hiding recurring-label tasks (toggle to show every task)"
            }
            onClick={() => setShowRecurringTodayTasks(!showRecurringTodayTasks)}
            className="relative inline-flex h-5 w-[34px] shrink-0 rounded-full border border-border bg-bg transition-colors data-[state=on]:border-fg-muted/40 data-[state=on]:bg-bg-elevated"
            data-state={showRecurringTodayTasks ? "on" : "off"}
          >
            <span
              className="pointer-events-none absolute top-px left-px h-[18px] w-[18px] rounded-full bg-fg-muted/60 shadow transition-transform data-[state=on]:translate-x-[14px] data-[state=on]:bg-fg-muted"
              data-state={showRecurringTodayTasks ? "on" : "off"}
            />
          </button>
        </div>
      </SectionHeader>

      {isEmpty ? (
        <div className="px-5 pb-2 text-[12px] text-fg-subtle">
          {tasks.length === 0
            ? "Nothing due. Quiet day."
            : "No open tasks in this view. Toggle recurring tasks to check if any are hidden, or you're all caught up."}
        </div>
      ) : (
        <ul>
          {visibleTasks.map((t) => (
            <TaskRow key={t.key} t={t} notionProjectPicklist={notionProjectPicklist} />
          ))}
        </ul>
      )}

      <AddTaskRow />
    </section>
  );
}
