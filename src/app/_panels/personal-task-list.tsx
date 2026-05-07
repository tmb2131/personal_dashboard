"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Subtask } from "@/lib/dashboard-data";
import { cn, formatRelativeDay, formatTimeWithSuffix } from "@/lib/utils";
import { setTodoistTaskDueAction } from "../actions";
import { SectionHeader } from "./section-header";

function formatDue(date: Date | null, dateHasTime: boolean, deadline: Date | null): string {
  const ref = date ?? deadline;
  if (!ref) return "No due date";
  const day = formatRelativeDay(ref);
  return dateHasTime ? `${day} ${formatTimeWithSuffix(ref)}` : day;
}

function toLocalDatetimeInputValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PersonalTaskDueEditor({ t }: { t: Subtask }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const initialRef = t.date ?? t.deadline;
  const [draft, setDraft] = useState(initialRef ? toLocalDatetimeInputValue(initialRef) : "");

  if (!t.todoistTaskId) {
    return (
      <span className="shrink-0 text-[11px] text-fg-subtle tabular-nums">
        {formatDue(t.date, t.dateHasTime, t.deadline)}
      </span>
    );
  }
  const todoistTaskId = t.todoistTaskId;

  const save = () => {
    if (!draft) return;
    setError(null);
    startTransition(async () => {
      const result = await setTodoistTaskDueAction({
        todoistTaskId,
        dueDatetime: draft,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const clear = () => {
    setError(null);
    startTransition(async () => {
      const result = await setTodoistTaskDueAction({
        todoistTaskId,
        dueDatetime: null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      setDraft("");
      router.refresh();
    });
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="shrink-0 text-[11px] text-fg-subtle tabular-nums hover:text-fg"
        title="Edit due date/time"
      >
        {formatDue(t.date, t.dateHasTime, t.deadline)}
      </button>
    );
  }

  return (
    <div className="shrink-0 space-y-1 text-right">
      <input
        type="datetime-local"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={pending}
        className="rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] text-fg"
      />
      <div className="flex justify-end gap-1 text-[11px]">
        <button
          type="button"
          onClick={save}
          disabled={pending || !draft}
          className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-fg-muted hover:text-fg disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={pending}
          className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-fg-muted hover:text-fg disabled:opacity-50"
        >
          No date
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setDraft(initialRef ? toLocalDatetimeInputValue(initialRef) : "");
            setError(null);
          }}
          disabled={pending}
          className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-fg-muted hover:text-fg disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && <div className="text-[11px] text-red-500">{error}</div>}
    </div>
  );
}

type PersonalTaskView = "personal" | "next7Days";

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
  const taskContext = (t: Subtask) =>
    t.projectTitle ? `Notion: ${t.projectTitle}` : t.categoryTitle ? `Todoist: ${t.categoryTitle}` : null;

  return (
    <section className="border-t border-border">
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
              <li key={t.key} className="flex items-start justify-between gap-3 px-5 py-2.5">
                <div className="min-w-0">
                  <div className="text-[13.5px]">{t.title}</div>
                  {context && (
                    <div className="mt-0.5 text-[11px] text-fg-subtle">{context}</div>
                  )}
                </div>
                <PersonalTaskDueEditor t={t} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
