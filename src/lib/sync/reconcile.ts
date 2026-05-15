/**
 * Drift-safety pass: scan every `task_links` row, recompute the pair's hash,
 * and run the appropriate mirror if it diverged from `lastSyncHash`.
 *
 * Why this exists: webhook handlers do their work in `Promise.resolve().then(...)` *after*
 * sending 200, which Vercel can terminate when a function instance shuts down. A webhook
 * can be acknowledged but never applied. Reconciliation catches that drift on a daily
 * cadence (cron) or on demand (manual button).
 */

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import { hashForPair, mirrorNotionFromTodoist, mirrorTodoistFromNotion } from "@/lib/sync/orchestrator";
import type { NotionPage, TodoistTask } from "@/lib/sync/mappings";

const STALE_PENDING_MS = 10 * 60 * 1000;

export type ReconcileSummary = {
  scanned: number;
  inSync: number;
  mirroredToTodoist: number;
  mirroredToNotion: number;
  closedArchived: number;
  staleCleared: number;
  missingRows: number;
  errors: { linkId: string; error: string }[];
};

export async function reconcileAllLinks(): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    scanned: 0,
    inSync: 0,
    mirroredToTodoist: 0,
    mirroredToNotion: 0,
    closedArchived: 0,
    staleCleared: 0,
    missingRows: 0,
    errors: [],
  };

  const links = await db.select().from(schema.taskLinks);
  const now = Date.now();

  for (const link of links) {
    summary.scanned++;
    try {
      const [page] = await db
        .select()
        .from(schema.notionPages)
        .where(eq(schema.notionPages.id, link.notionPageId));
      const [task] = await db
        .select()
        .from(schema.todoistTasks)
        .where(eq(schema.todoistTasks.id, link.todoistTaskId));

      if (!page || !task) {
        summary.missingRows++;
        await logAudit({
          source: "reconcile",
          op: "reconcile_missing_row",
          payload: {
            linkId: link.id,
            notionPageId: link.notionPageId,
            todoistTaskId: link.todoistTaskId,
            hasPage: !!page,
            hasTask: !!task,
          },
        });
        continue;
      }

      // Stale pending marker: an in-flight write that never cleaned up. Clear it and proceed.
      if (link.pendingOrigin != null && link.lastSyncAt.getTime() < now - STALE_PENDING_MS) {
        await db
          .update(schema.taskLinks)
          .set({ pendingOrigin: null })
          .where(eq(schema.taskLinks.id, link.id));
        summary.staleCleared++;
        await logAudit({
          source: "reconcile",
          op: "reconcile_cleared_stale_pending",
          payload: {
            linkId: link.id,
            staleFor: now - link.lastSyncAt.getTime(),
            pendingOrigin: link.pendingOrigin,
          },
        });
      } else if (link.pendingOrigin != null) {
        // A fresh in-flight write — leave it alone; the originating call will refresh the hash.
        continue;
      }

      const p = page as NotionPage;
      const t = task as TodoistTask;
      const currentHash = hashForPair(p, t);

      if (currentHash === link.lastSyncHash && !p.archived && !p.ignore) {
        summary.inSync++;
        continue;
      }

      // Archived/ignored Notion task with an open Todoist mirror — `mirrorTodoistFromNotion`
      // will close it. Drive in that direction regardless of timestamps.
      if ((p.archived || p.ignore) && !t.checked) {
        await mirrorTodoistFromNotion(link.notionPageId);
        summary.closedArchived++;
        continue;
      }

      // Tie-break by the more recently touched side. Both `updatedAt` columns are bumped
      // by every upsert / API write, so newer side ≈ authoritative.
      const pageMs = page.updatedAt.getTime();
      const taskMs = task.updatedAt.getTime();
      if (pageMs >= taskMs) {
        await mirrorTodoistFromNotion(link.notionPageId);
        summary.mirroredToTodoist++;
      } else {
        await mirrorNotionFromTodoist(link.todoistTaskId);
        summary.mirroredToNotion++;
      }
    } catch (e) {
      const msg = (e as Error).message;
      summary.errors.push({ linkId: link.id, error: msg });
      await logAudit({
        source: "reconcile",
        op: "reconcile_error",
        payload: { linkId: link.id, notionPageId: link.notionPageId, todoistTaskId: link.todoistTaskId },
        error: msg,
      });
    }
  }

  await logAudit({
    source: "reconcile",
    op: "reconcile_run",
    payload: summary as unknown as Record<string, unknown>,
  });

  return summary;
}
