import type { Subtask } from "@/lib/dashboard-data";
import { SectionHeader } from "./section-header";
import { TaskRow } from "./task-row";
import { AddTaskRow } from "./add-task-row";

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
        <div className="px-5 pb-2 text-[12px] text-fg-subtle">Nothing due. Quiet day.</div>
      ) : (
        <ul>
          {tasks.map((t) => (
            <TaskRow key={t.key} t={t} />
          ))}
        </ul>
      )}

      <AddTaskRow />
    </section>
  );
}
