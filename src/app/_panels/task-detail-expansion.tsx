"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Subtask } from "@/lib/dashboard-data";
import { formatRelativeDay, formatTimeWithSuffix } from "@/lib/utils";
import { setTodoistTaskDescriptionAction, setTodoistTaskDueAction } from "../actions";

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
  const [descriptionDraft, setDescriptionDraft] = useState(t.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const initialDue = t.date ?? t.deadline;
  const [dueDateDraft, setDueDateDraft] = useState(initialDue ? toDateInputValue(initialDue) : "");
  const [dueTimeDraft, setDueTimeDraft] = useState(initialDue && t.dateHasTime ? toTimeInputValue(initialDue) : "");
  const canEditTodoist = Boolean(t.todoistTaskId);

  const saveDescription = () => {
    if (!t.todoistTaskId) return;
    setError(null);
    startTransition(async () => {
      const result = await setTodoistTaskDescriptionAction({
        todoistTaskId: t.todoistTaskId!,
        description: descriptionDraft,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const saveDue = (dueDate: string | null, dueTime: string | null) => {
    if (!t.todoistTaskId) return;
    setError(null);
    startTransition(async () => {
      const result = await setTodoistTaskDueAction({
        todoistTaskId: t.todoistTaskId!,
        dueDate,
        dueTime,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (dueDate == null) {
        setDueDateDraft("");
        setDueTimeDraft("");
      }
      router.refresh();
    });
  };

  const setRelativeDue = (daysFromNow: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    const next = toDateInputValue(d);
    setDueDateDraft(next);
    setDueTimeDraft("");
    saveDue(next, null);
  };

  return (
    <div className="mt-2 ml-[30px] space-y-2 rounded border border-border bg-bg-elevated/60 p-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
        <span>Due: {formatTaskDue(t)}</span>
        {canEditTodoist && (
          <>
            <button type="button" onClick={() => setRelativeDue(0)} className="rounded border border-border px-1.5 py-0.5 hover:text-fg">
              Today
            </button>
            <button type="button" onClick={() => setRelativeDue(1)} className="rounded border border-border px-1.5 py-0.5 hover:text-fg">
              Tomorrow
            </button>
            <button type="button" onClick={() => setRelativeDue(7)} className="rounded border border-border px-1.5 py-0.5 hover:text-fg">
              Next week
            </button>
            <button type="button" onClick={() => saveDue(null, null)} className="rounded border border-border px-1.5 py-0.5 hover:text-fg">
              No date
            </button>
          </>
        )}
      </div>
      {canEditTodoist && (
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
          <button
            type="button"
            onClick={() => saveDue(dueDateDraft || null, dueTimeDraft || null)}
            disabled={pending}
            className="rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] hover:text-fg disabled:opacity-50"
          >
            Save due
          </button>
        </div>
      )}

      <div className="text-[11px] text-fg-subtle">Description</div>
      {canEditTodoist ? (
        <>
          <textarea
            value={descriptionDraft}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            rows={3}
            disabled={pending}
            placeholder="Add task details..."
            className="w-full resize-y rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-fg outline-none focus:border-fg-muted"
          />
          <div className="flex items-center gap-2 text-[11px]">
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
              onClick={() => setDescriptionDraft(t.description ?? "")}
              disabled={pending}
              className="rounded border border-border bg-bg px-2 py-0.5 text-fg-muted hover:text-fg disabled:opacity-50"
            >
              Reset
            </button>
          </div>
        </>
      ) : (
        <div className="text-[12px] text-fg-subtle">{t.description?.trim() || "No description."}</div>
      )}
      {(error || extraError) && (
        <div className="text-[11px] text-red-500/90">{error ?? extraError}</div>
      )}
    </div>
  );
}
