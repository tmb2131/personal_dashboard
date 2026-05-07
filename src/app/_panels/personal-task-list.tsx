"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Subtask } from "@/lib/dashboard-data";
import { formatRelativeDay, formatTimeWithSuffix } from "@/lib/utils";
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

  const save = () => {
    if (!t.todoistTaskId || !draft) return;
    setError(null);
    startTransition(async () => {
      const result = await setTodoistTaskDueAction({
        todoistTaskId: t.todoistTaskId!,
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
    if (!t.todoistTaskId) return;
    setError(null);
    startTransition(async () => {
      const result = await setTodoistTaskDueAction({
        todoistTaskId: t.todoistTaskId!,
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

export function PersonalTaskList({ tasks }: { tasks: Subtask[] }) {
  return (
    <section className="border-t border-border">
      <SectionHeader eyebrow="Personal" title="Tasks" count={tasks.length} source="todoist" />

      {tasks.length === 0 ? (
        <div className="px-5 pb-2 text-[12px] text-fg-subtle">No open Personal tasks.</div>
      ) : (
        <ul>
          {tasks.map((t) => (
            <li key={t.key} className="flex items-start justify-between gap-3 px-5 py-2.5">
              <div className="min-w-0">
                <div className="text-[13.5px]">{t.title}</div>
                {t.projectTitle && (
                  <div className="mt-0.5 text-[11px] text-fg-subtle">Notion: {t.projectTitle}</div>
                )}
              </div>
              <PersonalTaskDueEditor t={t} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
