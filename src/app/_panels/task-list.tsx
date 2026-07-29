"use client";

import { useMemo, useState } from "react";
import type { Subtask } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";
import { useDashboardMeta } from "./dashboard-meta-context";
import { dispatchShortcut, EmptyState } from "./empty-state";
import { SectionHeader } from "./section-header";
import { TaskRow } from "./task-row";
import { AddTaskRow } from "./add-task-row";
import { useTodayRecurringTasksVisibility } from "./today-recurring-tasks-context";

type SplitMode = "non-recurring" | "recurring";

export function TaskList({
  tasks,
  overdueTasks = [],
  notionProjectPicklist,
  source = "todoist",
  splitMode,
}: {
  tasks: Subtask[];
  overdueTasks?: Subtask[];
  notionProjectPicklist: { id: string; title: string }[];
  source?: string;
  splitMode?: SplitMode;
}) {
  const {
    showRecurringTodayTasks,
    setShowRecurringTodayTasks,
    showTodayRecurringSection,
    setShowTodayRecurringSection,
  } = useTodayRecurringTasksVisibility();
  const meta = useDashboardMeta();

  const { visibleTasks, visibleOverdue, visibleDone } = useMemo(() => {
    const byView = (list: Subtask[]) =>
      splitMode === "non-recurring"
        ? list.filter((t) => !t.hasRecurringTag)
        : splitMode === "recurring"
        ? list.filter((t) => t.hasRecurringTag)
        : showRecurringTodayTasks
        ? list
        : list.filter((t) => !t.hasRecurringTag);
    const inView = byView(tasks);
    return {
      visibleTasks: inView.filter((t) => !t.done),
      visibleOverdue: byView(overdueTasks).filter((t) => !t.done),
      visibleDone: inView.filter((t) => t.done),
    };
  }, [tasks, overdueTasks, showRecurringTodayTasks, splitMode]);

  const [showDone, setShowDone] = useState(false);

  const total = visibleTasks.length + visibleOverdue.length;
  const ratio = total.toString();
  const isEmpty = total === 0;
  // Open tasks regardless of the recurring view filter — distinguishes "nothing
  // left to do" from "everything left is hidden by the current view".
  const openAnywhere =
    tasks.filter((t) => !t.done).length + overdueTasks.filter((t) => !t.done).length;

  const isRecurringMode = splitMode === "recurring";
  const sectionId = isRecurringMode ? "today-recurring-tasks" : "today-tasks";
  const sectionTitle = isRecurringMode ? "Recurring" : "Tasks";
  const allClear =
    !isRecurringMode && openAnywhere === 0 && (meta?.todayMeetingCount ?? 0) === 0;

  const isTodayNonRecurring = splitMode === "non-recurring";
  const toggleValue = isTodayNonRecurring ? showTodayRecurringSection : showRecurringTodayTasks;
  const setToggle = isTodayNonRecurring ? setShowTodayRecurringSection : setShowRecurringTodayTasks;
  const toggleCopy = isTodayNonRecurring
    ? toggleValue
      ? "Showing Recurring"
      : "Hiding Recurring"
    : toggleValue
    ? "All tasks"
    : "Excluding Recurring folder";
  const toggleAriaLabel = isTodayNonRecurring
    ? toggleValue
      ? "Recurring section is visible. Switch to hide the Recurring section."
      : "Recurring section is hidden. Switch to show the Recurring section."
    : toggleValue
    ? "Today list shows every task including Recurring folder tasks. Switch to exclude Recurring folder tasks."
    : "Today list hides Recurring folder tasks. Switch to show all tasks.";
  const toggleTitle = isTodayNonRecurring
    ? toggleValue
      ? "Showing Recurring section (toggle to hide)"
      : "Recurring section hidden (toggle to show)"
    : toggleValue
    ? "Showing all tasks (toggle to hide Recurring folder tasks)"
    : "Hiding Recurring folder tasks (toggle to show every task)";

  return (
    <section
      id={sectionId}
      data-task-section
      className="border-t border-border scroll-mt-6"
    >
      <SectionHeader
        eyebrow="Today"
        title={sectionTitle}
        count={ratio}
        source={source}
        sourceKey="todoist"
      >
        {!isRecurringMode && (
          <div className="flex cursor-default select-none items-center gap-2 text-[11px] text-fg-muted">
            <span className="max-w-[9rem] leading-snug normal-case tracking-normal">
              {toggleCopy}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={toggleValue}
              aria-label={toggleAriaLabel}
              title={toggleTitle}
              onClick={() => setToggle(!toggleValue)}
              className="relative inline-flex h-5 w-[34px] shrink-0 rounded-full border border-border bg-bg transition-colors data-[state=on]:border-fg-muted/40 data-[state=on]:bg-bg-elevated"
              data-state={toggleValue ? "on" : "off"}
            >
              <span
                className="pointer-events-none absolute top-px left-px h-[18px] w-[18px] rounded-full bg-fg-muted/60 shadow transition-transform data-[state=on]:translate-x-[14px] data-[state=on]:bg-fg-muted"
                data-state={toggleValue ? "on" : "off"}
              />
            </button>
          </div>
        )}
      </SectionHeader>

      {isEmpty ? (
        isRecurringMode ? (
          <EmptyState message="No recurring tasks for today." />
        ) : openAnywhere === 0 && visibleDone.length > 0 ? (
          <EmptyState message="All done for today." tone="positive" />
        ) : openAnywhere === 0 ? (
          allClear ? (
            <EmptyState
              message="All clear for today."
              tone="positive"
              cta={{
                label: "Add something",
                onClick: () => dispatchShortcut("new-task"),
              }}
            />
          ) : (
            <EmptyState
              message="Quiet day."
              cta={{
                label: "Quick-add a task",
                onClick: () => dispatchShortcut("new-task"),
              }}
            />
          )
        ) : (
          <EmptyState
            message="No open tasks in this view."
            cta={
              !toggleValue
                ? {
                    label: "Show recurring tasks",
                    onClick: () => setToggle(true),
                  }
                : null
            }
          />
        )
      ) : (
        <>
          {visibleOverdue.length > 0 && (
            <>
              <div className="px-5 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-danger">
                Overdue
              </div>
              <ul>
                {visibleOverdue.map((t) => (
                  <TaskRow key={t.key} t={t} notionProjectPicklist={notionProjectPicklist} />
                ))}
              </ul>
              {visibleTasks.length > 0 && (
                <div className="px-5 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
                  Today
                </div>
              )}
            </>
          )}
          {visibleTasks.length > 0 && (
            <ul>
              {visibleTasks.map((t) => (
                <TaskRow key={t.key} t={t} notionProjectPicklist={notionProjectPicklist} />
              ))}
            </ul>
          )}
        </>
      )}

      {visibleDone.length > 0 && (
        <div className="px-5 pt-1">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-fg-subtle transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg-muted"
          >
            <svg
              aria-hidden
              width="8"
              height="8"
              viewBox="0 0 8 8"
              fill="none"
              className={cn(
                "transition-transform duration-200 ease-out motion-reduce:duration-0",
                showDone && "rotate-90",
              )}
            >
              <path
                d="M2.5 1L6 4L2.5 7"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Done today · {visibleDone.length}
          </button>
        </div>
      )}
      {showDone && visibleDone.length > 0 && (
        <ul>
          {visibleDone.map((t) => (
            <TaskRow key={t.key} t={t} notionProjectPicklist={notionProjectPicklist} />
          ))}
        </ul>
      )}

      {!isRecurringMode && (
        <AddTaskRow
          notionProjectPicklist={notionProjectPicklist}
          autoOpen={tasks.length === 0 && overdueTasks.length === 0}
        />
      )}
    </section>
  );
}
