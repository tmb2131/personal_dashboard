"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";
import {
  createProjectSubtaskAction,
  toggleTaskDoneAction,
  updateProjectSubtaskAction,
} from "../actions";

function toDateInputValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dueLabel(date: Date | null, deadline: Date | null): string {
  const ref = date ?? deadline;
  if (!ref) return "No due date";
  return ref.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function ProjectSubtaskPlanner({
  parentId,
  subtasks,
  className,
}: {
  parentId: string;
  subtasks: Project["subtasks"];
  className?: string;
}) {
  const router = useRouter();
  const [taskPending, startTaskTransition] = useTransition();
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [taskError, setTaskError] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingDueDate, setEditingDueDate] = useState("");

  const handleAddSubtask = (e: FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setTaskError(null);
    startTaskTransition(async () => {
      const result = await createProjectSubtaskAction({
        notionParentPageId: parentId,
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
    <div className={className}>
      {subtasks.length === 0 ? (
        <div className="pb-2 text-[12px] text-fg-subtle">No open sub-tasks.</div>
      ) : (
        <ul className="space-y-1 pb-2">
          {subtasks.map((s) => {
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
  );
}
