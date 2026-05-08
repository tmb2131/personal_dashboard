"use client";

import { useMemo } from "react";
import type { Subtask } from "@/lib/dashboard-data";
import { SectionHeader } from "./section-header";
import { TaskRow } from "./task-row";
import { AddTaskRow } from "./add-task-row";
import { useTodayRecurringTasksVisibility } from "./today-recurring-tasks-context";

type SplitMode = "non-recurring" | "recurring";

export function TaskList({
  tasks,
  notionProjectPicklist,
  source = "todoist",
  splitMode,
}: {
  tasks: Subtask[];
  notionProjectPicklist: { id: string; title: string }[];
  source?: string;
  splitMode?: SplitMode;
}) {
  const { showRecurringTodayTasks, setShowRecurringTodayTasks } = useTodayRecurringTasksVisibility();

  const visibleTasks = useMemo(() => {
    const filtered =
      splitMode === "non-recurring"
        ? tasks.filter((t) => !t.hasRecurringTag)
        : splitMode === "recurring"
        ? tasks.filter((t) => t.hasRecurringTag)
        : showRecurringTodayTasks
        ? tasks
        : tasks.filter((t) => !t.hasRecurringTag);
    return filtered.filter((t) => !t.done);
  }, [tasks, showRecurringTodayTasks, splitMode]);

  const total = visibleTasks.length;
  const ratio = total.toString();
  const isEmpty = total === 0;

  const isRecurringMode = splitMode === "recurring";
  const sectionId = isRecurringMode ? "today-recurring-tasks" : "today-tasks";
  const sectionTitle = isRecurringMode ? "Recurring" : "Tasks";

  return (
    <section id={sectionId} className="border-t border-border scroll-mt-6">
      <SectionHeader eyebrow="Today" title={sectionTitle} count={ratio} source={source}>
        {!isRecurringMode && (
          <div className="flex cursor-default select-none items-center gap-2 text-[11px] text-fg-muted">
            <span className="max-w-[9rem] leading-snug normal-case tracking-normal">
              {showRecurringTodayTasks ? "All tasks" : "Excluding Recurring folder"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={showRecurringTodayTasks}
              aria-label={
                showRecurringTodayTasks
                  ? "Today list shows every task including Recurring folder tasks. Switch to exclude Recurring folder tasks."
                  : "Today list hides Recurring folder tasks. Switch to show all tasks."
              }
              title={
                showRecurringTodayTasks
                  ? "Showing all tasks (toggle to hide Recurring folder tasks)"
                  : "Hiding Recurring folder tasks (toggle to show every task)"
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
        )}
      </SectionHeader>

      {isEmpty ? (
        <div className="px-5 pb-2 text-[12px] text-fg-subtle">
          {isRecurringMode
            ? "No recurring tasks for today."
            : tasks.length === 0
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

      {!isRecurringMode && <AddTaskRow notionProjectPicklist={notionProjectPicklist} />}
    </section>
  );
}
