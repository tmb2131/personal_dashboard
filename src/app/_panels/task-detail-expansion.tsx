"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import type { Subtask } from "@/lib/dashboard-data";
import { cn, formatRelativeDay, formatTimeWithSuffix } from "@/lib/utils";
import {
  setTodoistTaskContentAction,
  setTodoistTaskDescriptionAction,
  setTodoistTaskDueAction,
  updateProjectSubtaskAction,
} from "../actions";

type CrossPostResult = { ok: true } | { ok: false; error: string };

function toDateInputValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeInputValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatTaskDue(t: Subtask): string {
  const ref = t.date ?? t.deadline;
  if (!ref) return "No due date";
  const day = formatRelativeDay(ref);
  return t.dateHasTime ? `${day} ${formatTimeWithSuffix(ref)}` : day;
}

export function TaskDetailExpansion({
  t,
  extraError,
}: {
  t: Subtask;
  extraError?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initialDue = t.date ?? t.deadline;
  const initialTitle = t.title;
  const initialDescription = t.description ?? "";
  const initialDueDate = initialDue ? toDateInputValue(initialDue) : "";
  const initialDueTime = initialDue && t.dateHasTime ? toTimeInputValue(initialDue) : "";
  const [titleDraft, setTitleDraft] = useState(initialTitle);
  const [descriptionDraft, setDescriptionDraft] = useState(initialDescription);
  const [dueDateDraft, setDueDateDraft] = useState(initialDueDate);
  const [dueTimeDraft, setDueTimeDraft] = useState(initialDueTime);
  const canEditDue = Boolean(t.todoistTaskId || t.notionPageId);
  const canEditTodoist = Boolean(t.todoistTaskId);
  const canEditTitle = Boolean(t.notionPageId || t.todoistTaskId);
  const titleChanged = titleDraft.trim() !== initialTitle.trim();
  const titleValid = titleDraft.trim().length > 0;
  const descriptionChanged = canEditTodoist && descriptionDraft !== initialDescription;
  const dueChanged = canEditDue && (dueDateDraft !== initialDueDate || dueTimeDraft !== initialDueTime);
  const hasChanges = titleChanged || descriptionChanged || dueChanged;
  const canSave = hasChanges && (!titleChanged || titleValid);

  const discard = () => {
    setTitleDraft(initialTitle);
    setDescriptionDraft(initialDescription);
    setDueDateDraft(initialDueDate);
    setDueTimeDraft(initialDueTime);
    setError(null);
  };

  const saveAll = () => {
    if (!canSave) return;
    setError(null);
    startTransition(async () => {
      const nextTitle = titleDraft.trim();
      const nextDescription = descriptionDraft;
      const nextDueDate = dueDateDraft || null;
      const nextDueTime = dueDateDraft ? (dueTimeDraft || null) : null;

      if (titleChanged && t.notionPageId) {
        // updateProjectSubtaskAction writes title + due + description in one call
        // (Notion + linked Todoist). Fold any concurrent changes in.
        const result = await updateProjectSubtaskAction({
          notionPageId: t.notionPageId,
          title: nextTitle,
          dueDate: dueChanged ? nextDueDate : initialDueDate || null,
          description: descriptionChanged ? nextDescription : initialDescription,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // If due also changed and we passed it above, we're done. Same for
        // description. But Todoist due/time updates need the time component,
        // which the project action does not accept — push it separately when
        // a time-of-day was added/changed.
        if (dueChanged && nextDueTime !== initialDueTime) {
          const dueResult = await setTodoistTaskDueAction({
            todoistTaskId: t.todoistTaskId,
            notionPageId: t.notionPageId,
            dueDate: nextDueDate,
            dueTime: nextDueTime,
          });
          if (!dueResult.ok) {
            setError(dueResult.error);
            return;
          }
        }
        router.refresh();
        return;
      }

      const steps: Array<() => Promise<CrossPostResult>> = [];
      if (titleChanged && !t.notionPageId && t.todoistTaskId) {
        steps.push(() =>
          setTodoistTaskContentAction({ todoistTaskId: t.todoistTaskId!, content: nextTitle }),
        );
      }
      if (dueChanged) {
        steps.push(() =>
          setTodoistTaskDueAction({
            todoistTaskId: t.todoistTaskId,
            notionPageId: t.notionPageId,
            dueDate: nextDueDate,
            dueTime: nextDueTime,
          }),
        );
      }
      if (descriptionChanged && t.todoistTaskId) {
        steps.push(() =>
          setTodoistTaskDescriptionAction({
            todoistTaskId: t.todoistTaskId!,
            description: nextDescription,
          }),
        );
      }

      for (const step of steps) {
        const result = await step();
        if (!result.ok) {
          setError(result.error);
          return;
        }
      }
      router.refresh();
    });
  };

  const handleTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveAll();
    } else if (e.key === "Escape") {
      e.preventDefault();
      discard();
    }
  };

  const setRelativeDue = (daysFromNow: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    setDueDateDraft(toDateInputValue(d));
  };

  const clearDue = () => {
    setDueDateDraft("");
    setDueTimeDraft("");
  };

  return (
    <div className="mt-2 ml-[30px] space-y-2 rounded border border-border bg-bg-elevated/60 p-2">
      {canEditTitle && (
        <div className="space-y-1">
          <div className="text-[11px] text-fg-subtle">Title</div>
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={handleTitleKeyDown}
            disabled={pending}
            placeholder="Task title"
            aria-label="Task title"
            className="w-full rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-fg outline-none focus:border-fg-muted"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
        <span>Due: {formatTaskDue(t)}</span>
        {canEditDue && (
          <>
            <button
              type="button"
              onClick={() => setRelativeDue(0)}
              disabled={pending}
              className={cn(
                "rounded border border-border px-1.5 py-0.5 hover:text-fg disabled:opacity-50",
                dueDateDraft === toDateInputValue(new Date()) && "border-fg-muted text-fg",
              )}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setRelativeDue(1)}
              disabled={pending}
              className="rounded border border-border px-1.5 py-0.5 hover:text-fg disabled:opacity-50"
            >
              Tomorrow
            </button>
            <button
              type="button"
              onClick={() => setRelativeDue(7)}
              disabled={pending}
              className="rounded border border-border px-1.5 py-0.5 hover:text-fg disabled:opacity-50"
            >
              Next week
            </button>
            <button
              type="button"
              onClick={clearDue}
              disabled={pending}
              className="rounded border border-border px-1.5 py-0.5 hover:text-fg disabled:opacity-50"
            >
              No date
            </button>
          </>
        )}
      </div>
      {canEditDue && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            value={dueDateDraft}
            onChange={(e) => setDueDateDraft(e.target.value)}
            disabled={pending}
            className="rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] text-fg"
          />
          <input
            type="time"
            value={dueTimeDraft}
            onChange={(e) => setDueTimeDraft(e.target.value)}
            disabled={pending || !dueDateDraft}
            aria-label="Due time"
            title="Optional due time"
            className="rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] text-fg disabled:opacity-50"
          />
        </div>
      )}

      <div className="text-[11px] text-fg-subtle">Description</div>
      {canEditTodoist ? (
        <textarea
          value={descriptionDraft}
          onChange={(e) => setDescriptionDraft(e.target.value)}
          rows={3}
          disabled={pending}
          placeholder="Add task details..."
          className="w-full resize-y rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-fg outline-none focus:border-fg-muted"
        />
      ) : (
        <div className="text-[12px] text-fg-subtle">{t.description?.trim() || "No description."}</div>
      )}
      {(canEditTitle || canEditDue || canEditTodoist) && (
        <div className="flex items-center gap-2 pt-1 text-[11px]">
          <button
            type="button"
            onClick={saveAll}
            disabled={pending || !canSave}
            className="rounded border border-border bg-bg px-2 py-0.5 text-fg-muted hover:text-fg disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={discard}
            disabled={pending || !hasChanges}
            className="rounded border border-border bg-bg px-2 py-0.5 text-fg-muted hover:text-fg disabled:opacity-50"
          >
            Discard
          </button>
        </div>
      )}
      {(error || extraError) && (
        <div className="text-[11px] text-red-500/90">{error ?? extraError}</div>
      )}
    </div>
  );
}
