import { categoryDot, cn } from "@/lib/utils";
import type { Subtask } from "@/lib/dashboard-data";
import { SectionHeader } from "./section-header";

function TaskRow({ t }: { t: Subtask }) {
  const dotColor = categoryDot(t.categoryTitle);
  return (
    <li className="group flex items-start gap-3 px-5 py-2.5">
      <button
        type="button"
        aria-label={t.done ? "Mark not done" : "Mark done"}
        className={cn(
          "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition",
          t.done
            ? "border-fg bg-fg text-bg"
            : "border-border-strong hover:border-fg-muted",
          t.inProgress && !t.done && "border-accent",
        )}
      >
        {t.done && (
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
        {t.inProgress && !t.done && (
          <span className="h-[6px] w-[6px] rounded-full bg-accent" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-[13.5px]",
            t.done && "line-through text-fg-subtle",
          )}
        >
          {t.title}
        </div>
        {(t.estimateMinutes || t.projectTitle) && (
          <div
            className={cn(
              "mt-0.5 flex items-center gap-2 text-[11px] text-fg-subtle",
              t.done && "line-through",
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

export function TaskList({
  tasks,
  doneCount,
  source = "todoist",
}: {
  tasks: Subtask[];
  doneCount: number;
  source?: string;
}) {
  const total = tasks.length;
  const ratio = total > 0 ? `${doneCount}/${total}` : "0";
  const isEmpty = total === 0;

  return (
    <section className="border-t border-border">
      <SectionHeader eyebrow="Today" title="Tasks" count={ratio} source={source} />

      {isEmpty ? (
        <div className="px-5 pb-5 text-[12px] text-fg-subtle">Nothing due. Quiet day.</div>
      ) : (
        <ul>
          {tasks.map((t) => (
            <TaskRow key={t.key} t={t} />
          ))}
        </ul>
      )}

      <button
        type="button"
        className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-[12px] text-fg-subtle hover:text-fg"
      >
        <span className="text-[14px] leading-none">+</span>
        Add task
      </button>
    </section>
  );
}
