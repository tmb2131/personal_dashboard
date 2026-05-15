"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Subtask } from "@/lib/dashboard-data";
import { setTodoistTaskDueAction, toggleTaskDoneAction } from "../actions";

const UNDO_TIMEOUT_MS = 5_000;
const MOVE_FEEDBACK_MS = 2_500;

function toIsoDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function useTaskRowActions(t: Subtask) {
  const router = useRouter();
  const [done, setDone] = useState(t.done);
  const [lastSyncedDone, setLastSyncedDone] = useState(t.done);
  if (t.done !== lastSyncedDone) {
    setDone(t.done);
    setLastSyncedDone(t.done);
  }
  const [pending, startTransition] = useTransition();
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

  const canToggle = Boolean(t.notionPageId || t.todoistTaskId);
  const canReschedule = !t.done && (Boolean(t.todoistTaskId) || Boolean(t.notionPageId));

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

  const toggleDone = () => {
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

  const undoDone = () => {
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

  return {
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
  };
}

export type ReschedulePreset = {
  key: string;
  label: string;
  days: number;
  hint: string;
  title?: string;
};

export const RESCHEDULE_PRESETS: readonly ReschedulePreset[] = [
  { key: "t", label: "Today", days: 0, hint: "today" },
  { key: "m", label: "Tomorrow", days: 1, hint: "tomorrow" },
  { key: "w", label: "+1w", days: 7, hint: "next week", title: "Push out 1 week" },
];
