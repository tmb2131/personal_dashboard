"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Subtask } from "@/lib/dashboard-data";
import { categoryDot } from "@/lib/utils";
import { moveTaskToProjectAction } from "../actions";

export function TaskDragProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [activeTask, setActiveTask] = useState<Subtask | null>(null);
  const [, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as Subtask | undefined;
    setActiveTask(task ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const task = event.active.data.current?.task as Subtask | undefined;
    const targetParentPageId = event.over?.data.current?.targetParentPageId as
      | string
      | undefined;
    setActiveTask(null);

    if (!task || !targetParentPageId) return;
    if (task.projectId === targetParentPageId) return;

    startTransition(async () => {
      const result = await moveTaskToProjectAction({
        notionPageId: task.notionPageId,
        todoistTaskId: task.todoistTaskId,
        source: task.source,
        currentParentPageId: task.projectId,
        targetParentPageId,
      });
      if (result.ok) {
        router.refresh();
      } else {
        console.error("Failed to move task:", result.error);
      }
    });
  };

  return (
    <DndContext
      // Without an explicit id, dnd-kit derives its `aria-describedby` ids from
      // a module-level counter. The counter advances at a different rate on the
      // server than in a freshly loaded client, so restoring a saved view
      // (which mounts a different set of droppables during hydration) produced
      // a `DndDescribedBy-N` hydration mismatch on every drag handle.
      id="dashboard-tasks"
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveTask(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeTask ? <TaskDragPreview task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function TaskDragPreview({ task }: { task: Subtask }) {
  const dotColor = categoryDot(task.categoryTitle);
  return (
    <div className="pointer-events-none flex max-w-[320px] items-center gap-2 rounded-lg border border-border-strong bg-bg-elevated px-3 py-2 text-[13.5px] text-fg">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: dotColor }}
      />
      <span className="truncate">{task.title}</span>
    </div>
  );
}
