import { logAudit } from "@/lib/sync/audit";
import { mirrorNotionFromTodoist, repairRecurringTodoistLink } from "@/lib/sync/orchestrator";
import type { SyncTodoistResult } from "@/lib/sync/todoist";

export async function reconcileTodoistCompletionResult(
  result: Pick<SyncTodoistResult, "completedTaskIds" | "completedRecurringTaskIds">,
  source: string,
) {
  let mirrored = 0;
  let repaired = 0;

  for (const id of result.completedTaskIds) {
    try {
      await mirrorNotionFromTodoist(id);
      mirrored++;
    } catch (e) {
      await logAudit({
        source,
        op: "mirror_completed_error",
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
