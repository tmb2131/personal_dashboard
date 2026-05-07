"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Subtask } from "@/lib/dashboard-data";
import { cn, formatRelativeDay, formatTimeWithSuffix } from "@/lib/utils";
import { setTodoistTaskDueAction } from "../actions";
import { setTodoistTaskDescriptionAction } from "../actions";
import { toggleTaskDoneAction } from "../actions";
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
  const [draftDescription, setDraftDescription] = useState(t.description ?? "");
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const canToggle = Boolean(t.notionPageId || t.todoistTaskId);
  const canEditDescription = Boolean(t.todoistTaskId);

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

  const saveDescription = () => {
    if (!t.todoistTaskId) return;
    setDescriptionError(null);
    startTransition(async () => {
      const result = await setTodoistTaskDescriptionAction({
        todoistTaskId: t.todoistTaskId!,
        description: draftDescription,
      });
      if (!result.ok) {
        setDescriptionError(result.error);
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
      <PersonalTaskDueEditor t={t} />
      </div>
      {expanded && (
        <div className="ml-[30px] mt-2 rounded border border-border bg-bg-elevated/60 p-2">
          <div className="mb-1 text-[11px] text-fg-subtle">Description</div>
          {canEditDescription ? (
            <>
              <textarea
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                rows={4}
                disabled={pending}
                placeholder="Add task details..."
                className="w-full resize-y rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-fg outline-none focus:border-fg-muted"
              />
              <div className="mt-1 flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={saveDescription}
                  disabled={pending}
                  className="rounded border border-border bg-bg px-2 py-0.5 text-fg-muted hover:text-fg disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftDescription(t.description ?? "");
                    setDescriptionError(null);
                  }}
                  disabled={pending}
                  className="rounded border border-border bg-bg px-2 py-0.5 text-fg-muted hover:text-fg disabled:opacity-50"
                >
                  Reset
                </button>
                {descriptionError && <span className="text-red-500">{descriptionError}</span>}
              </div>
            </>
          ) : (
            <div className="text-[12px] text-fg-subtle">
              {t.description?.trim() || "No description."}
            </div>
          )}
        </div>
      )}
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
              <PersonalTaskRow key={t.key} t={t} context={context} />
            );
          })}
        </ul>
      )}
    </section>
  );
}
