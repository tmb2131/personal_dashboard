"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Subtask } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";
import { toggleTaskDoneAction } from "../actions";
import { SectionHeader } from "./section-header";
import { formatTaskDue, TaskDetailExpansion } from "./task-detail-expansion";

type PersonalTaskView = "personal" | "next7Days";

function PersonalTaskRow({
  t,
  context,
}: {
  t: Subtask;
  context: string | null;
}) {
  const router = useRouter();
  const [done, setDone] = useState(t.done);
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const canToggle = Boolean(t.notionPageId || t.todoistTaskId);

  const handleToggleDone = () => {
    if (!canToggle) return;
    const next = !done;
    setDone(next);
    startTransition(async () => {
      const result = await toggleTaskDoneAction({
        notionPageId: t.notionPageId,
        todoistTaskId: t.todoistTaskId,
        done: next,
      });
      if (!result.ok) {
        setDone(!next);
        return;
      }
      router.refresh();
    });
  };

  return (
    <li className="px-5 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
        <button
          type="button"
          onClick={handleToggleDone}
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
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              "cursor-pointer text-left text-[13.5px] hover:text-fg-muted",
              done && "line-through text-fg-subtle",
            )}
            title={expanded ? "Hide details" : "Show details"}
          >
            {t.title}
          </button>
          {context && (
            <div className={cn("mt-0.5 text-[11px] text-fg-subtle", done && "line-through")}>
              {context}
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

export function PersonalTaskList({
  tasks,
  next7DaysTasks,
}: {
  tasks: Subtask[];
  next7DaysTasks: Subtask[];
}) {
  const [view, setView] = useState<PersonalTaskView>("personal");
  const visibleTasks = view === "personal" ? tasks : next7DaysTasks;
  const emptyCopy =
    view === "personal"
      ? "No open Personal tasks."
      : "No open tasks due in the next 7 days.";
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
        <div className="px-5 pb-2 text-[12px] text-fg-subtle">{emptyCopy}</div>
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
