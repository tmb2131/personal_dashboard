"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { categoryDot, cn } from "@/lib/utils";
import type { Subtask } from "@/lib/dashboard-data";
import {
  pushNotionTaskToTodoistAction,
  pushTodoistTaskToNotionAction,
  setTodoistTaskDueAction,
  toggleTaskDoneAction,
} from "../actions";
import { TaskDetailExpansion } from "./task-detail-expansion";

const UNDO_TIMEOUT_MS = 5_000;
const MOVE_FEEDBACK_MS = 2_500;

function toIsoDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function TaskRow({
  t,
  notionProjectPicklist,
}: {
  t: Subtask;
  notionProjectPicklist: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [done, setDone] = useState(t.done);
  const [lastSyncedDone, setLastSyncedDone] = useState(t.done);
  if (t.done !== lastSyncedDone) {
    // Parent re-rendered with fresh data; reconcile optimistic mirror.
    setDone(t.done);
    setLastSyncedDone(t.done);
  }
  const [pending, startTransition] = useTransition();
  const [crossPostError, setCrossPostError] = useState<string | null>(null);
  const [selectedParent, setSelectedParent] = useState("");
  const [showNotionProjectSelector, setShowNotionProjectSelector] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showUndo, setShowUndo] = useState(false);
  const [moveMessage, setMoveMessage] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const moveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
      if (moveTimerRef.current) window.clearTimeout(moveTimerRef.current);
    };
  }, []);

  const resolvedNotionParent =
    notionProjectPicklist.find((p) => p.id === selectedParent)?.id
    ?? notionProjectPicklist[0]?.id
    ?? "";

  const dotColor = categoryDot(t.categoryTitle);
  const canToggle = Boolean(t.notionPageId || t.todoistTaskId);
  const canReschedule = !t.done && (Boolean(t.todoistTaskId) || Boolean(t.notionPageId));

  const showTodoist = t.source === "notion" && Boolean(t.notionPageId) && !t.todoistTaskId;
  const showNotion =
    t.source === "todoist" &&
    Boolean(t.todoistTaskId) &&
    !t.notionPageId &&
    !t.hasRecurringTag;

  const clearUndoTimer = () => {
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  };

  const clearMoveTimer = () => {
    if (moveTimerRef.current) {
      window.clearTimeout(moveTimerRef.current);
      moveTimerRef.current = null;
    }
  };

  const handleClick = () => {
    if (!canToggle) return;
    const next = !done;
    setDone(next);
    clearUndoTimer();
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
      if (next) {
        setShowUndo(true);
        undoTimerRef.current = window.setTimeout(() => {
          setShowUndo(false);
          undoTimerRef.current = null;
        }, UNDO_TIMEOUT_MS);
      } else {
        setShowUndo(false);
      }
      router.refresh();
    });
  };

  const handleUndo = () => {
    clearUndoTimer();
    setShowUndo(false);
    setDone(false);
    startTransition(async () => {
      const result = await toggleTaskDoneAction({
        notionPageId: t.notionPageId,
        todoistTaskId: t.todoistTaskId,
        done: false,
      });
      if (!result.ok) {
        setDone(true);
        return;
      }
      router.refresh();
    });
  };

  const reschedule = (daysFromNow: number, label: string) => {
    if (!canReschedule) return;
    const target = new Date();
    target.setDate(target.getDate() + daysFromNow);
    const iso = toIsoDate(target);
    setMoveError(null);
    setMoveMessage(`Moved to ${label}`);
    clearMoveTimer();
    moveTimerRef.current = window.setTimeout(() => {
      setMoveMessage(null);
      moveTimerRef.current = null;
    }, MOVE_FEEDBACK_MS);
    startTransition(async () => {
      const result = await setTodoistTaskDueAction({
        todoistTaskId: t.todoistTaskId,
        notionPageId: t.notionPageId,
        dueDate: iso,
        dueTime: null,
      });
      if (!result.ok) {
        setMoveError(result.error);
        setMoveMessage(null);
        clearMoveTimer();
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
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              "min-w-0 flex-1 truncate text-left text-[13.5px] transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg-muted",
              done && "line-through text-fg-subtle",
            )}
            title={expanded ? "Hide details" : "Show details"}
          >
            {t.title}
          </button>
          {canReschedule && (
            <div
              className={cn(
                "flex shrink-0 items-center gap-1 text-[10px] text-fg-subtle opacity-0 transition-opacity duration-150 ease-out motion-reduce:duration-0",
                "group-hover:opacity-100 focus-within:opacity-100",
              )}
            >
              <RescheduleChip
                label="Today"
                onClick={() => reschedule(0, "today")}
                disabled={pending}
              />
              <RescheduleChip
                label="Tomorrow"
                onClick={() => reschedule(1, "tomorrow")}
                disabled={pending}
              />
              <RescheduleChip
                label="+1w"
                onClick={() => reschedule(7, "next week")}
                disabled={pending}
                title="Push out 1 week"
              />
            </div>
          )}
          {showUndo && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-2 py-px text-[10px] text-fg-muted">
              Done
              <button
                type="button"
                onClick={handleUndo}
                disabled={pending}
                className="underline decoration-dotted underline-offset-2 hover:text-fg disabled:opacity-50"
              >
                undo
              </button>
            </span>
          )}
        </div>
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
        {(moveMessage || moveError) && (
          <div className="mt-0.5 text-[10px]">
            {moveError ? (
              <span className="text-red-500/90">{moveError}</span>
            ) : (
              <span aria-live="polite" className="text-fg-subtle">{moveMessage}</span>
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

function RescheduleChip({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? `Reschedule to ${label}`}
      className="rounded border border-border bg-bg px-1.5 py-px tabular-nums hover:border-fg-muted hover:text-fg disabled:opacity-50"
    >
      {label}
    </button>
  );
}
