"use client";

import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Subtask } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";
import { DragHandle } from "./drag-handle";
import { dispatchShortcut, EmptyState } from "./empty-state";
import { SectionHeader } from "./section-header";
import { formatTaskDue, TaskDetailExpansion } from "./task-detail-expansion";
import { handleRowKeyDown } from "./task-row";
import { RESCHEDULE_PRESETS, useTaskRowActions } from "./use-task-row-actions";

type PersonalTaskView = "personal" | "next7Days";

function PersonalTaskRow({
  t,
  context,
}: {
  t: Subtask;
  context: string | null;
}) {
  const {
    done,
    pending,
    expanded,
    setExpanded,
    showUndo,
    moveMessage,
    moveError,
    toggleError,
    canToggle,
    canReschedule,
    toggleDone,
    undoDone,
    reschedule,
  } = useTaskRowActions(t);

  const dragDisabled = t.source === "todoist" && t.hasRecurringTag;
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDraggableRef,
    isDragging,
  } = useDraggable({
    id: t.key,
    data: { task: t },
    disabled: dragDisabled,
  });

  return (
    <li
      ref={setDraggableRef}
      className={cn(
        "group rounded-lg px-5 py-2.5 transition-colors duration-200 ease-out motion-reduce:duration-0 hover:bg-bg-elevated/50 focus-within:bg-bg-elevated/40",
        isDragging && "opacity-50",
      )}
      onKeyDown={(e) =>
        handleRowKeyDown(e, { toggleDone, reschedule, setExpanded, canToggle, canReschedule })
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {!dragDisabled && (
            <DragHandle
              {...dragAttributes}
              {...dragListeners}
              isDragging={isDragging}
              className="mt-1"
            />
          )}
          {dragDisabled && <span aria-hidden className="mt-1 w-[10px] shrink-0" />}
          <button
            type="button"
            onClick={toggleDone}
            disabled={!canToggle || pending}
            aria-label={done ? "Mark not done" : "Mark done"}
            className={cn(
              "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition",
              done ? "border-fg bg-fg text-bg" : "border-border-strong hover:border-fg-muted",
              t.inProgress && !done && "border-accent",
              pending && "opacity-60",
              !canToggle && "cursor-default",
            )}
          >
            {done && (
              <svg width="10" height="10" viewBox="0 0 9 9" fill="none">
                <path
                  d="M1 4.5l2.5 2.5L8 1"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {t.inProgress && !done && (
              <span className="h-[6px] w-[6px] rounded-full bg-accent" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className={cn(
                  "min-w-0 flex-1 cursor-pointer truncate text-left text-[13.5px] transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg-muted",
                  done && "line-through text-fg-subtle",
                )}
                title={expanded ? "Hide details" : "Show details"}
              >
                {t.title}
              </button>
              {canReschedule && (
                <div
                  className={cn(
                    "hidden shrink-0 items-center gap-1 text-[10px] text-fg-subtle",
                    "md:group-hover:flex md:focus-within:flex",
                  )}
                >
                  {RESCHEDULE_PRESETS.map((preset) => (
                    <RescheduleChip
                      key={preset.key}
                      label={preset.label}
                      onClick={() => reschedule(preset.days, preset.hint)}
                      disabled={pending}
                      title={preset.title}
                    />
                  ))}
                </div>
              )}
              {showUndo && (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-2 py-px text-[10px] text-fg-muted">
                  Done
                  <button
                    type="button"
                    onClick={undoDone}
                    disabled={pending}
                    className="underline decoration-dotted underline-offset-2 hover:text-fg disabled:opacity-50"
                  >
                    undo
                  </button>
                </span>
              )}
            </div>
            {canReschedule && (
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-fg-subtle md:hidden">
                {RESCHEDULE_PRESETS.map((preset) => (
                  <RescheduleChip
                    key={preset.key}
                    label={preset.label}
                    onClick={() => reschedule(preset.days, preset.hint)}
                    disabled={pending}
                    title={preset.title}
                  />
                ))}
              </div>
            )}
            {context && (
              <div className={cn("mt-0.5 text-[11px] text-fg-subtle", done && "line-through")}>
                {context}
              </div>
            )}
            {(moveMessage || moveError || toggleError) && (
              <div className="mt-0.5 text-[10px]">
                {moveError || toggleError ? (
                  <span aria-live="polite" className="text-danger">
                    {moveError ?? toggleError}
                  </span>
                ) : (
                  <span aria-live="polite" className="text-fg-subtle">{moveMessage}</span>
                )}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-[11px] text-fg-subtle tabular-nums hover:text-fg"
          title={expanded ? "Hide details" : "Show details"}
        >
          {formatTaskDue(t)}
        </button>
      </div>
      {expanded && <TaskDetailExpansion t={t} />}
    </li>
  );
}

function RescheduleChip({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? `Reschedule to ${label}`}
      className="rounded border border-border bg-bg px-1.5 py-px tabular-nums hover:border-fg-muted hover:text-fg disabled:opacity-50"
    >
      {label}
    </button>
  );
}

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
          {visibleTasks.map((t) => {
            const context = taskContext(t);

            return (
              <PersonalTaskRow key={t.key} t={t} context={context} />
            );
          })}
        </ul>
      )}
    </section>
  );
}
