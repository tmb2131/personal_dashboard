"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import { categoryDot, cn, isEditableTarget } from "@/lib/utils";
import type { Subtask } from "@/lib/dashboard-data";
import {
  pushNotionTaskToTodoistAction,
  pushTodoistTaskToNotionAction,
} from "../actions";
import { DragHandle } from "./drag-handle";
import { TaskDetailExpansion } from "./task-detail-expansion";
import { RESCHEDULE_PRESETS, useTaskRowActions } from "./use-task-row-actions";

export function TaskRow({
  t,
  notionProjectPicklist,
}: {
  t: Subtask;
  notionProjectPicklist: { id: string; title: string }[];
}) {
  const router = useRouter();
  const {
    done,
    pending,
    expanded,
    setExpanded,
    showUndo,
    moveMessage,
    moveError,
    canToggle,
    canReschedule,
    toggleDone,
    undoDone,
    reschedule,
  } = useTaskRowActions(t);

  const [crossPostError, setCrossPostError] = useState<string | null>(null);
  const [selectedParent, setSelectedParent] = useState("");
  const [showNotionProjectSelector, setShowNotionProjectSelector] = useState(false);
  const [crossPostPending, startCrossPostTransition] = useTransition();

  const dragDisabled = t.source === "todoist" && t.hasRecurringTag;
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDraggableRef,
    isDragging,
  } = useDraggable({
    id: t.key,
    data: { task: t },
    disabled: dragDisabled,
  });

  const resolvedNotionParent =
    notionProjectPicklist.find((p) => p.id === selectedParent)?.id
    ?? notionProjectPicklist[0]?.id
    ?? "";

  const dotColor = categoryDot(t.categoryTitle);

  const showTodoist = t.source === "notion" && Boolean(t.notionPageId) && !t.todoistTaskId;
  const showNotion =
    t.source === "todoist" &&
    Boolean(t.todoistTaskId) &&
    !t.notionPageId &&
    !t.hasRecurringTag;

  const handlePushTodoist = () => {
    const id = t.notionPageId;
    if (!id) return;
    setCrossPostError(null);
    startCrossPostTransition(async () => {
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
    startCrossPostTransition(async () => {
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

  const rowBusy = pending || crossPostPending;

  return (
    <li
      ref={setDraggableRef}
      data-task-row
      className={cn(
        "group rounded-lg px-5 py-2.5 transition-colors duration-200 ease-out motion-reduce:duration-0 hover:bg-bg-elevated/50 focus-within:bg-bg-elevated/40",
        isDragging && "opacity-50",
      )}
      onKeyDown={(e) => handleRowKeyDown(e, { toggleDone, reschedule, setExpanded, canToggle, canReschedule })}
    >
      <div className="flex items-start gap-2">
      {!dragDisabled && (
        <DragHandle
          {...dragAttributes}
          {...dragListeners}
          isDragging={isDragging}
          className="mt-1"
        />
      )}
      {dragDisabled && <span aria-hidden className="mt-1 w-[10px] shrink-0" />}
      <button
        type="button"
        onClick={toggleDone}
        disabled={!canToggle || rowBusy}
        aria-label={done ? "Mark not done" : "Mark done"}
        className={cn(
          "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition",
          done
            ? "border-fg bg-fg text-bg"
            : "border-border-strong hover:border-fg-muted",
          t.inProgress && !done && "border-accent",
          rowBusy && "opacity-60",
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
            data-task-focus-target
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              "min-w-0 flex-1 truncate text-left text-[13.5px] transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg-muted",
              done && "line-through text-fg-subtle",
            )}
            title={expanded ? "Hide details" : "Click to edit / show details"}
          >
            {t.title}
          </button>
          {!done && t.overdueDays != null && (
            <span
              className="mt-0.5 inline-flex shrink-0 items-center rounded-full border border-danger/40 bg-danger/10 px-1.5 py-px text-[10px] tabular-nums text-danger"
              title={`Due ${t.overdueDays === 1 ? "1 day" : `${t.overdueDays} days`} ago`}
            >
              {t.overdueDays}d overdue
            </span>
          )}
          {canReschedule && (
            <div
              className={cn(
                "hidden shrink-0 items-center gap-1 text-[10px] text-fg-subtle",
                "md:group-hover:flex md:focus-within:flex",
              )}
            >
              {RESCHEDULE_PRESETS.map((preset) => (
                <RescheduleChip
                  key={preset.key}
                  label={preset.label}
                  onClick={() => reschedule(preset.days, preset.hint)}
                  disabled={pending}
                  title={preset.title}
                />
              ))}
            </div>
          )}
          {showUndo && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-2 py-px text-[10px] text-fg-muted">
              Done
              <button
                type="button"
                onClick={undoDone}
                disabled={pending}
                className="underline decoration-dotted underline-offset-2 hover:text-fg disabled:opacity-50"
              >
                undo
              </button>
            </span>
          )}
        </div>
        {canReschedule && (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-fg-subtle md:hidden">
            {RESCHEDULE_PRESETS.map((preset) => (
              <RescheduleChip
                key={preset.key}
                label={preset.label}
                onClick={() => reschedule(preset.days, preset.hint)}
                disabled={pending}
                title={preset.title}
              />
            ))}
          </div>
        )}
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
              <span className="text-danger">{moveError}</span>
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
                disabled={crossPostPending}
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
                    disabled={crossPostPending}
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
                      disabled={crossPostPending}
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
                      disabled={crossPostPending || !resolvedNotionParent}
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
              <span className="text-[11px] text-danger">{crossPostError}</span>
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

export function handleRowKeyDown(
  e: KeyboardEvent<HTMLLIElement>,
  args: {
    toggleDone: () => void;
    reschedule: (daysFromNow: number, label: string) => void;
    setExpanded: (updater: (v: boolean) => boolean) => void;
    canToggle: boolean;
    canReschedule: boolean;
  },
) {
  if (e.defaultPrevented) return;
  if (isEditableTarget(e.target)) return;

  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>("[data-task-focus-target]"),
    ).filter((el) => el.offsetParent !== null);
    if (targets.length === 0) return;
    const current = document.activeElement as HTMLElement | null;
    const index = current ? targets.indexOf(current) : -1;
    let nextIndex: number;
    if (index === -1) {
      nextIndex = e.key === "ArrowDown" ? 0 : targets.length - 1;
    } else {
      nextIndex = e.key === "ArrowDown" ? index + 1 : index - 1;
      if (nextIndex < 0 || nextIndex >= targets.length) return;
    }
    e.preventDefault();
    targets[nextIndex]?.focus();
    return;
  }

  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  const key = e.key.toLowerCase();
  if (key === "d") {
    if (!args.canToggle) return;
    e.preventDefault();
    args.toggleDone();
    return;
  }
  if (key === "e") {
    e.preventDefault();
    args.setExpanded((v) => !v);
    return;
  }
  if (!args.canReschedule) return;
  const preset = RESCHEDULE_PRESETS.find((p) => p.key === key);
  if (preset) {
    e.preventDefault();
    args.reschedule(preset.days, preset.hint);
  }
}
