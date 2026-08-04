"use client";

import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import type { Subtask } from "@/lib/dashboard-data";
import { formatDateOnlyLocal, parseDateTimeLocal } from "@/lib/date-utils";
import { cn, formatHHMM, formatTimeWithSuffix } from "@/lib/utils";
import { setTodoistTaskDueAction } from "../actions";

const RECURRING_HINT = "Repeating task — change the time in Todoist to keep the repeat";

function timeLabel(day: Date, hhmm: string): string {
  const at = parseDateTimeLocal(formatDateOnlyLocal(day), hhmm);
  return at ? formatTimeWithSuffix(at) : hhmm;
}

/**
 * Due time on a Today row, editable in place. Writes through
 * `setTodoistTaskDueAction`, which keeps the day and swaps only the time, so an
 * overdue task stays overdue.
 *
 * Tasks that land in Today via their deadline alone have no `date` to attach a
 * time to — Todoist deadlines are date-only — so they render nothing.
 */
export function TaskTimeChip({ t }: { t: Subtask }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipBlurRef = useRef(false);

  const serverTime = t.date && t.dateHasTime ? formatHHMM(t.date) : null;
  const [time, setTime] = useState(serverTime);
  const [lastSyncedTime, setLastSyncedTime] = useState(serverTime);
  if (serverTime !== lastSyncedTime) {
    setTime(serverTime);
    setLastSyncedTime(serverTime);
  }

  const editable =
    !t.done &&
    !t.dueIsRecurring &&
    t.date != null &&
    Boolean(t.todoistTaskId || t.notionPageId);

  if (!time && !editable) return null;

  const label = time && t.date ? timeLabel(t.date, time) : null;

  if (!editable) {
    return (
      <span
        title={t.dueIsRecurring ? RECURRING_HINT : undefined}
        className="mt-0.5 shrink-0 text-[11px] tabular-nums text-fg-subtle"
      >
        {label}
      </span>
    );
  }

  const commit = (next: string | null) => {
    setEditing(false);
    if (next === time) return;
    const previous = time;
    setTime(next);
    setError(null);
    startTransition(async () => {
      const result = await setTodoistTaskDueAction({
        todoistTaskId: t.todoistTaskId,
        notionPageId: t.notionPageId,
        dueDate: formatDateOnlyLocal(t.date!),
        dueTime: next,
      });
      if (!result.ok) {
        setTime(previous);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      skipBlurRef.current = true;
      commit(e.currentTarget.value || null);
    } else if (e.key === "Escape") {
      e.preventDefault();
      skipBlurRef.current = true;
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        type="time"
        autoFocus
        defaultValue={time ?? ""}
        aria-label="Due time"
        onKeyDown={handleKeyDown}
        onBlur={(e) => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          commit(e.target.value || null);
        }}
        className="mt-px shrink-0 rounded border border-border bg-bg px-1 py-px text-[11px] tabular-nums text-fg"
      />
    );
  }

  // An unset time is an affordance, not information — it rides along with the
  // reschedule chips next to it, revealed on hover and always shown on mobile.
  const onlyOnHover =
    "hidden max-md:inline-flex md:group-hover:inline-flex md:group-focus-within:inline-flex";

  return (
    <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[11px] text-fg-subtle">
      <button
        type="button"
        onClick={() => {
          skipBlurRef.current = false;
          setEditing(true);
        }}
        disabled={pending}
        title={time ? "Change due time" : "Set a due time"}
        className={cn(
          "relative tabular-nums before:absolute before:-inset-2 before:content-[''] hover:text-fg disabled:opacity-50",
          !time && onlyOnHover,
        )}
      >
        {label ?? "＋time"}
      </button>
      {time && (
        <button
          type="button"
          onClick={() => commit(null)}
          disabled={pending}
          aria-label="Clear due time"
          title="Clear due time (keeps the date)"
          className={cn(
            "relative before:absolute before:-inset-2 before:content-[''] hover:text-fg disabled:opacity-50",
            onlyOnHover,
          )}
        >
          ×
        </button>
      )}
      {error && (
        <span
          aria-live="polite"
          title={error}
          className="max-w-[8rem] truncate text-[10px] text-danger"
        >
          {error}
        </span>
      )}
    </span>
  );
}
