"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import type { Project } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";
import {
  createProjectSubtaskAction,
  toggleTaskDoneAction,
  updateProjectSubtaskAction,
} from "../actions";
import { SectionHeader } from "./section-header";

function daysUntil(d: Date, from = new Date()): number {
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ms = startOfDay(d) - startOfDay(from);
  return Math.round(ms / 86_400_000);
}

function formatDayMonth(d: Date): string {
  return d
    .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    .replace(".", "");
}

function durationDays(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return days >= 0 ? days : null;
}

function toDateInputValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dueLabel(date: Date | null, deadline: Date | null): string {
  const ref = date ?? deadline;
  if (!ref) return "No due date";
  return ref.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function TripRow({ trip, now }: { trip: Project; now: Date }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [taskPending, startTaskTransition] = useTransition();
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [taskError, setTaskError] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingDueDate, setEditingDueDate] = useState("");

  const days = trip.dateStart ? Math.max(0, daysUntil(trip.dateStart, now)) : null;
  const dur = durationDays(trip.dateStart, trip.dateEnd);
  const isBooked = trip.status === "Done";
  const fallbackSubtask = [...trip.subtasks]
    .filter((s) => !s.done)
    .sort((a, b) => {
      if (a.inProgress !== b.inProgress) return a.inProgress ? -1 : 1;
      const at = (a.date ?? a.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bt = (b.date ?? b.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (at !== bt) return at - bt;
      return a.title.localeCompare(b.title);
    })[0];
  const nextStep = trip.keyNextStep ?? fallbackSubtask?.title ?? null;
  const sortedSubtasks = trip.subtasks.filter((s) => !s.done).sort((a, b) => {
    const at = (a.date ?? a.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bt = (b.date ?? b.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (at !== bt) return at - bt;
    return a.title.localeCompare(b.title);
  });

  const handleAddSubtask = (e: FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setTaskError(null);
    startTaskTransition(async () => {
      const result = await createProjectSubtaskAction({
        notionParentPageId: trip.id,
        title,
        description: newDescription,
        dueDate: newDueDate || null,
      });
      if (!result.ok) {
        setTaskError(result.error);
        return;
      }
      setNewTitle("");
      setNewDescription("");
      setNewDueDate("");
      setExpanded(true);
      router.refresh();
    });
  };

  const beginEdit = (task: Project["subtasks"][number]) => {
    if (!task.notionPageId) return;
    const taskDue = task.date ?? task.deadline;
    setEditingTaskId(task.notionPageId);
    setEditingTitle(task.title);
    setEditingDescription(task.description ?? "");
    setEditingDueDate(taskDue ? toDateInputValue(taskDue) : "");
    setTaskError(null);
  };

  const saveEdit = () => {
    if (!editingTaskId || !editingTitle.trim()) return;
    setTaskError(null);
    startTaskTransition(async () => {
      const result = await updateProjectSubtaskAction({
        notionPageId: editingTaskId,
        title: editingTitle.trim(),
        description: editingDescription,
        dueDate: editingDueDate || null,
      });
      if (!result.ok) {
        setTaskError(result.error);
        return;
      }
      setEditingTaskId(null);
      setEditingTitle("");
      setEditingDescription("");
      setEditingDueDate("");
      router.refresh();
    });
  };

  const toggleSubtaskDone = (task: Project["subtasks"][number]) => {
    if (!task.notionPageId && !task.todoistTaskId) return;
    setTaskError(null);
    startTaskTransition(async () => {
      const result = await toggleTaskDoneAction({
        notionPageId: task.notionPageId,
        todoistTaskId: task.todoistTaskId,
        done: !task.done,
      });
      if (!result.ok) {
        setTaskError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <li className="px-5 py-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-4 text-left"
        aria-expanded={expanded}
      >
        <div className="w-12 shrink-0 text-right">
          <div className="text-[26px] font-medium leading-none tabular-nums">
            {days ?? "—"}
          </div>
          <div className="mt-1 text-[10px] tracking-[0.14em] text-fg-subtle">
            DAYS
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[14px] font-medium">{trip.title}</span>
            {isBooked && <Pill>BOOKED</Pill>}
            {!isBooked && <Pill>PLANNING</Pill>}
          </div>
          <div className="mt-1 flex items-baseline gap-2 text-[12px] text-fg-muted tabular-nums">
            {trip.dateStart && <span>{formatDayMonth(trip.dateStart)}</span>}
            {trip.dateEnd && trip.dateStart && (
              <>
                <span>→</span>
                <span>{formatDayMonth(trip.dateEnd)}</span>
              </>
            )}
            {dur != null && <span>· {dur}d</span>}
          </div>
          {nextStep ? (
            <div className="mt-1 truncate text-[12px] text-fg-muted">
              <span className="text-fg-subtle">→</span> {nextStep}
            </div>
          ) : (
            <div className="mt-1 text-[12px] text-fg-subtle">No next step</div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="mt-2 ml-16">
          {sortedSubtasks.length === 0 ? (
            <div className="pb-2 text-[12px] text-fg-subtle">No sub-tasks yet.</div>
          ) : (
            <ul className="space-y-1 pb-2">
              {sortedSubtasks.map((s) => {
                const rowKey = s.notionPageId ?? s.key;
                const isEditing = Boolean(s.notionPageId && editingTaskId === s.notionPageId);
                return (
                  <li key={rowKey} className="rounded border border-border px-2.5 py-2">
                    {isEditing ? (
                      <div className="space-y-1.5">
                        <input
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          disabled={taskPending}
                          className="h-7 w-full rounded border border-border bg-bg px-2 text-[12px] text-fg outline-none"
                        />
                        <textarea
                          value={editingDescription}
                          onChange={(e) => setEditingDescription(e.target.value)}
                          placeholder="Description"
                          disabled={taskPending}
                          rows={2}
                          className="w-full resize-none rounded border border-border bg-bg px-2 py-1 text-[12px] text-fg outline-none placeholder:text-fg-subtle"
                        />
                        <div className="flex items-center gap-1.5">
                          <input
                            type="date"
                            value={editingDueDate}
                            onChange={(e) => setEditingDueDate(e.target.value)}
                            disabled={taskPending}
                            className="h-7 rounded border border-border bg-bg px-2 text-[11px] text-fg"
                          />
                          <button
                            type="button"
                            onClick={saveEdit}
                            disabled={taskPending || !editingTitle.trim()}
                            className="rounded border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-muted hover:text-fg disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTaskId(null);
                              setEditingTitle("");
                              setEditingDescription("");
                              setEditingDueDate("");
                              setTaskError(null);
                            }}
                            disabled={taskPending}
                            className="rounded border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-muted hover:text-fg disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleSubtaskDone(s)}
                            disabled={taskPending}
                            aria-label={s.done ? "Mark not done" : "Mark done"}
                            className={cn(
                              "flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border transition",
                              s.done
                                ? "border-fg bg-fg text-bg"
                                : "border-border-strong hover:border-fg-muted",
                              taskPending && "opacity-60",
                            )}
                          >
                            {s.done && (
                              <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                                <path
                                  d="M1 4.5l2.5 2.5L8 1"
                                  stroke="currentColor"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </button>
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-[12px]",
                              s.done && "line-through text-fg-subtle",
                            )}
                          >
                            {s.title}
                          </span>
                          <span className="shrink-0 text-[11px] text-fg-subtle">
                            {dueLabel(s.date, s.deadline)}
                          </span>
                          {s.notionPageId && (
                            <button
                              type="button"
                              onClick={() => beginEdit(s)}
                              disabled={taskPending}
                              className="shrink-0 rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-[11px] text-fg-muted hover:text-fg disabled:opacity-50"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                        {s.description && (
                          <div className="truncate pl-6 text-[11px] text-fg-subtle">
                            {s.description}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <form onSubmit={handleAddSubtask} className="flex flex-wrap items-center gap-1.5">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Add sub-task title"
              disabled={taskPending}
              className="h-7 min-w-[12rem] flex-1 rounded border border-border bg-bg px-2 text-[12px] text-fg outline-none placeholder:text-fg-subtle"
            />
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Description"
              disabled={taskPending}
              className="h-7 min-w-[12rem] flex-1 rounded border border-border bg-bg px-2 text-[12px] text-fg outline-none placeholder:text-fg-subtle"
            />
            <input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              disabled={taskPending}
              className="h-7 rounded border border-border bg-bg px-2 text-[11px] text-fg"
            />
            <button
              type="submit"
              disabled={taskPending || !newTitle.trim()}
              className="rounded border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-muted hover:text-fg disabled:opacity-50"
            >
              Add
            </button>
          </form>
          {taskError && <div className="mt-1 text-[11px] text-red-500">{taskError}</div>}
        </div>
      )}
    </li>
  );
}

export function UpcomingTrips({ trips, now }: { trips: Project[]; now: Date }) {
  return (
    <section className="border-t border-border">
      <SectionHeader eyebrow="Upcoming Trips" title="" count={trips.length} source="notion" />

      {trips.length === 0 ? (
        <div className="px-5 pb-5 text-[12px] text-fg-subtle">Nothing on the horizon</div>
      ) : (
        <ul>
          {trips.map((trip) => (
            <TripRow key={trip.id} trip={trip} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto inline-flex items-center rounded bg-pill-bg px-1.5 py-0.5 text-[10px] tracking-[0.14em] text-pill-fg">
      {children}
    </span>
  );
}
