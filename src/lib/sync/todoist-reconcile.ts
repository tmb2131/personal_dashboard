import { logAudit } from "@/lib/sync/audit";
import { mirrorNotionFromTodoist, repairRecurringTodoistLink } from "@/lib/sync/orchestrator";
import type { SyncTodoistResult } from "@/lib/sync/todoist";

export async function reconcileTodoistSyncResult(
  result: Pick<
    SyncTodoistResult,
    "changedTaskIds" | "completedTaskIds" | "completedRecurringTaskIds"
  >,
  source: string,
) {
  let mirrored = 0;
  let repaired = 0;

  // Completions first (their mirror must run against the original task id before any
  // recurring-link repair), then field edits (due date, title, priority) observed by the
  // poll. Without the second loop, Todoist-side edits reach the local cache but never Notion.
  const completed = new Set(result.completedTaskIds);
  const toMirror = [
    ...result.completedTaskIds,
    ...result.changedTaskIds.filter((id) => !completed.has(id)),
  ];

  for (const id of toMirror) {
    try {
      await mirrorNotionFromTodoist(id);
      mirrored++;
    } catch (e) {
      await logAudit({
        source,
        op: "mirror_error",
        payload: { id },
        error: (e as Error).message,
      });
    }
  }

  for (const id of result.completedRecurringTaskIds) {
    try {
      const rep = await repairRecurringTodoistLink(id);
      if (rep.repaired) repaired++;
    } catch (e) {
      await logAudit({
        source,
        op: "repair_recurring_error",
        payload: { id },
        error: (e as Error).message,
      });
    }
  }

  return { mirrored, repaired };
}
