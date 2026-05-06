"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { categoryDot, cn } from "@/lib/utils";
import type { Subtask } from "@/lib/dashboard-data";
import { toggleTaskDoneAction } from "../actions";

export function TaskRow({ t }: { t: Subtask }) {
  const router = useRouter();
  const [done, setDone] = useState(t.done);
  const [pending, startTransition] = useTransition();
  const dotColor = categoryDot(t.categoryTitle);
  const canToggle = Boolean(t.notionPageId || t.todoistTaskId);

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

  return (
    <li className="group flex items-start gap-3 px-5 py-2.5">
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
        <div
          className={cn(
            "truncate text-[13.5px]",
            done && "line-through text-fg-subtle",
          )}
        >
          {t.title}
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
      </div>
    </li>
  );
}
