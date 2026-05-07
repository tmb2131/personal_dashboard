"use client";

import { categoryDot, cn, shortCategoryLabel } from "@/lib/utils";
import type { Project, ProjectGroups } from "@/lib/dashboard-data";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import {
  createProjectSubtaskAction,
  setProjectFocusAction,
  updateProjectSubtaskAction,
} from "../actions";
import { SectionHeader } from "./section-header";

function FocusStarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden className="block">
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
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

function ProjectRow({ p }: { p: Project }) {
  const router = useRouter();
  const [focusOverride, setFocusOverride] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();
  const [taskPending, startTaskTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [taskError, setTaskError] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDueDate, setEditingDueDate] = useState("");

  const isFocus = focusOverride ?? (p.focus === "Yes");

  const dot = categoryDot(p.categoryTitle);
  const cat = shortCategoryLabel(p.categoryTitle);
  const fallbackSubtask = [...p.subtasks]
    .filter((s) => !s.done)
    .sort((a, b) => {
      if (a.inProgress !== b.inProgress) return a.inProgress ? -1 : 1;
      const at = (a.date ?? a.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bt = (b.date ?? b.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (at !== bt) return at - bt;
      return a.title.localeCompare(b.title);
    })[0];
  const nextStep = p.keyNextStep ?? fallbackSubtask?.title ?? null;
  const sortedSubtasks = p.subtasks.filter((s) => !s.done).sort((a, b) => {
    const at = (a.date ?? a.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bt = (b.date ?? b.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (at !== bt) return at - bt;
    return a.title.localeCompare(b.title);
  });

  const handleToggleFocus = () => {
    const next = !isFocus;
    setFocusOverride(next);
    startTransition(async () => {
      const result = await setProjectFocusAction({
        notionPageId: p.id,
        focus: next ? "Yes" : "No",
      });
      if (!result.ok) {
        setFocusOverride(!next);
        return;
      }
      setFocusOverride(null);
      router.refresh();
    });
  };

  const handleAddSubtask = (e: FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setTaskError(null);
    startTaskTransition(async () => {
      const result = await createProjectSubtaskAction({
        notionParentPageId: p.id,
        title,
        dueDate: newDueDate || null,
      });
      if (!result.ok) {
        setTaskError(result.error);
        return;
      }
      setNewTitle("");
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
        dueDate: editingDueDate || null,
      });
      if (!result.ok) {
        setTaskError(result.error);
        return;
      }
      setEditingTaskId(null);
      setEditingTitle("");
      setEditingDueDate("");
      router.refresh();
    });
  };

  return (
    <li className="px-5 py-2.5">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={handleToggleFocus}
          aria-label={isFocus ? "Remove from Focus" : "Mark as Focus"}
          aria-pressed={isFocus}
          disabled={pending}
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted/40",
            isFocus ? "text-fg" : "text-fg-subtle hover:text-fg-muted",
            pending && "opacity-60",
          )}
        >
          <FocusStarIcon filled={isFocus} />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          aria-expanded={expanded}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: dot }}
          />
          <span className="truncate text-[13.5px] font-medium">{p.title}</span>
          {cat && (
            <span className="text-[10px] tracking-[0.14em] text-fg-subtle">{cat}</span>
          )}
          <span className="ml-auto flex shrink-0 items-baseline gap-3 text-[11px] text-fg-muted">
            {p.openSubtasks > 0 && (
              <span className="tabular-nums">
                {p.openSubtasks} open
              </span>
            )}
            <span className="text-fg-subtle">{expanded ? "Hide" : "Show"}</span>
          </span>
        </button>
      </div>
      <div className="mt-1.5 ml-[44px]">
        {nextStep ? (
          <span className="truncate text-[12px] text-fg-muted">
            <span className="text-fg-subtle">→</span> {nextStep}
          </span>
        ) : (
          <span className="text-[12px] text-fg-subtle">No next step</span>
        )}
      </div>
      {expanded && (
        <div className="mt-2 ml-[44px]">
          {sortedSubtasks.length === 0 ? (
            <div className="pb-2 text-[12px] text-fg-subtle">No open sub-tasks.</div>
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
                      <div className="flex items-center gap-2">
                        <span className={cn("min-w-0 flex-1 truncate text-[12px]", s.done && "line-through text-fg-subtle")}>
                          {s.title}
                        </span>
                        <span className="shrink-0 text-[11px] text-fg-subtle">{dueLabel(s.date, s.deadline)}</span>
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

function Tab({
  label,
  count,
  active,
}: {
  label: string;
  count: number;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 rounded-md px-2 py-1 text-[12px]",
        active ? "bg-pill-bg text-fg" : "text-fg-muted",
      )}
    >
      {label}
      <span className="tabular-nums text-fg-subtle">{count}</span>
    </span>
  );
}

export function Projects({ groups }: { groups: ProjectGroups }) {
  const [view, setView] = useState<"focus" | "nonFocus" | "all">("focus");
  const list =
    view === "focus" ? groups.focus : view === "nonFocus" ? groups.nonFocus : groups.all;

  const emptyMessage =
    view === "focus"
      ? "No focused projects"
      : view === "nonFocus"
        ? "No non-focus projects"
        : "No projects";

  return (
    <section className="border-t border-border">
      <SectionHeader eyebrow="Projects" title="" count={groups.all.length} source="notion" />

      <div className="flex flex-wrap items-center gap-1 px-5 pb-2">
        <button
          onClick={() => setView("focus")}
          type="button"
          aria-pressed={view === "focus"}
          className="rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted/40"
        >
          <Tab label="Focus" count={groups.focus.length} active={view === "focus"} />
        </button>
        <button
          onClick={() => setView("nonFocus")}
          type="button"
          aria-pressed={view === "nonFocus"}
          className="rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted/40"
        >
          <Tab label="Non-Focus" count={groups.nonFocus.length} active={view === "nonFocus"} />
        </button>
        <button
          onClick={() => setView("all")}
          type="button"
          aria-pressed={view === "all"}
          className="rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted/40"
        >
          <Tab label="All" count={groups.all.length} active={view === "all"} />
        </button>
      </div>

      {list.length === 0 ? (
        <div className="px-5 pb-5 text-[12px] text-fg-subtle">{emptyMessage}</div>
      ) : (
        <ul>
          {list.map((p) => (
            <ProjectRow key={p.id} p={p} />
          ))}
        </ul>
      )}
    </section>
  );
}
