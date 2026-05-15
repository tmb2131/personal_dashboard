"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { categoryDot, cn } from "@/lib/utils";
import type { Subtask } from "@/lib/dashboard-data";
import {
  pushNotionTaskToTodoistAction,
  pushTodoistTaskToNotionAction,
  toggleTaskDoneAction,
} from "../actions";
import { TaskDetailExpansion } from "./task-detail-expansion";

export function TaskRow({
  t,
  notionProjectPicklist,
}: {
  t: Subtask;
  notionProjectPicklist: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [done, setDone] = useState(t.done);
  const [pending, startTransition] = useTransition();
  const [crossPostError, setCrossPostError] = useState<string | null>(null);
  const [selectedParent, setSelectedParent] = useState("");
  const [showNotionProjectSelector, setShowNotionProjectSelector] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const resolvedNotionParent =
    notionProjectPicklist.find((p) => p.id === selectedParent)?.id
    ?? notionProjectPicklist[0]?.id
    ?? "";

  const dotColor = categoryDot(t.categoryTitle);
  const canToggle = Boolean(t.notionPageId || t.todoistTaskId);

  const showTodoist = t.source === "notion" && Boolean(t.notionPageId) && !t.todoistTaskId;
  const showNotion =
    t.source === "todoist" &&
    Boolean(t.todoistTaskId) &&
    !t.notionPageId &&
    !t.hasRecurringTag;

  const handleClick = () => {
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

  const handlePushTodoist = () => {
    const id = t.notionPageId;
    if (!id) return;
    setCrossPostError(null);
    startTransition(async () => {
      const result = await pushNotionTaskToTodoistAction(id);
      if (!result.ok) {
        setCrossPostError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const handlePushNotion = () => {
    const taskId = t.todoistTaskId;
    if (!taskId || !resolvedNotionParent) return;
    setCrossPostError(null);
    startTransition(async () => {
      const result = await pushTodoistTaskToNotionAction({
        todoistTaskId: taskId,
        notionParentPageId: resolvedNotionParent,
      });
      if (!result.ok) {
        setCrossPostError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <li className="group rounded-lg px-5 py-2.5 transition-colors duration-200 ease-out motion-reduce:duration-0 hover:bg-bg-elevated/50">
      <div className="flex items-start gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={!canToggle || pending}
        aria-label={done ? "Mark not done" : "Mark done"}
        className={cn(
          "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition",
          done
            ? "border-fg bg-fg text-bg"
            : "border-border-strong hover:border-fg-muted",
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

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            "truncate text-left text-[13.5px] transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg-muted",
            done && "line-through text-fg-subtle",
          )}
          title={expanded ? "Hide details" : "Show details"}
        >
          {t.title}
        </button>
        {(t.estimateMinutes || t.projectTitle) && (
          <div
            className={cn(
              "mt-0.5 flex items-center gap-2 text-[11px] text-fg-subtle",
              done && "line-through",
            )}
          >
            {t.estimateMinutes != null && (
              <span className="tabular-nums">{t.estimateMinutes}m</span>
            )}
            {t.estimateMinutes != null && t.projectTitle && <span>·</span>}
            {t.projectTitle && (
              <span className="inline-flex items-center gap-1.5 truncate">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: dotColor }}
                />
                <span className="truncate">{t.projectTitle}</span>
              </span>
            )}
          </div>
        )}

        {(showTodoist || showNotion) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {showTodoist && (
              <button
                type="button"
                disabled={pending}
                onClick={handlePushTodoist}
                className="rounded border border-border bg-bg-elevated px-2 py-0.5 text-[11px] text-fg-muted transition-colors duration-200 ease-out motion-reduce:duration-0 hover:border-fg-muted hover:text-fg disabled:opacity-50"
              >
                Add to Todoist
              </button>
            )}
            {showNotion && (
              <>
                {!showNotionProjectSelector ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setShowNotionProjectSelector(true)}
                    className="rounded border border-border bg-bg-elevated px-2 py-0.5 text-[11px] text-fg-muted transition-colors duration-200 ease-out motion-reduce:duration-0 hover:border-fg-muted hover:text-fg disabled:opacity-50"
                  >
                    Add to Notion
                  </button>
                ) : notionProjectPicklist.length > 0 ? (
                  <>
                    <select
                      aria-label="Notion parent project"
                      value={resolvedNotionParent}
                      onChange={(e) => setSelectedParent(e.target.value)}
                      disabled={pending}
                      className="max-w-[10rem] rounded border border-border bg-bg py-0.5 pr-6 pl-1.5 text-[11px] text-fg-muted"
                    >
                      {notionProjectPicklist.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={pending || !resolvedNotionParent}
                      onClick={handlePushNotion}
                      className="rounded border border-border bg-bg-elevated px-2 py-0.5 text-[11px] text-fg-muted transition-colors duration-200 ease-out motion-reduce:duration-0 hover:border-fg-muted hover:text-fg disabled:opacity-50"
                    >
                      Add to Notion
                    </button>
                  </>
                ) : (
                  <span className="text-[11px] text-fg-subtle">
                    No Notion projects — create a top-level task in Notion first.
                  </span>
                )}
              </>
            )}
            {crossPostError && (
              <span className="text-[11px] text-red-500/90">{crossPostError}</span>
            )}
          </div>
        )}
      </div>
      </div>

      {expanded && (
        <TaskDetailExpansion t={t} extraError={crossPostError} />
      )}
    </li>
  );
}
