/**
 * Daily-cron belt-and-suspenders for webhooks: scan recent `event_received` audit
 * rows that have no paired completion row and replay the incremental path.
 *
 * Why: even with `after()` keeping the function alive, a deploy or instance
 * restart can cut work short. The webhook is acked (Notion/Todoist won't resend),
 * so the only place to notice the gap is on our side.
 */

import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import { mirrorTodoistFromNotion, mirrorNotionFromTodoist } from "@/lib/sync/orchestrator";
import { syncNotionEntitiesByIds } from "@/lib/sync/notion";
import {
  deleteTodoistTaskCacheRow,
  markTodoistProjectArchived,
  syncTodoistProjectsByIds,
  syncTodoistTasksByIds,
} from "@/lib/sync/todoist";
import {
  NOTION_COMPLETION_OPS,
  TODOIST_COMPLETION_OPS,
  pairOrphans,
  pickId,
  type AuditRowLite,
  type AuditRowPayload,
} from "@/lib/sync/orphan-replay-utils";

export type ReplaySummary = {
  scanned: number;
  notionReplayed: number;
  todoistReplayed: number;
  skipped: number;
  errors: { fingerprint: string; error: string }[];
};

async function findOrphans(
  source: "webhook-notion" | "webhook-todoist",
  completionOps: Set<string>,
  windowHours: number,
): Promise<{ fingerprint: string; payload: AuditRowPayload }[]> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  // Fetch both sides in one shot, then pair them in memory. Cheap for a single
  // user's volume (tens to hundreds of events per day).
  const rows = await db
    .select({ op: schema.auditLog.op, payload: schema.auditLog.payload })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.source, source), gt(schema.auditLog.ts, since)));

  return pairOrphans(rows as AuditRowLite[], completionOps);
}

export async function replayOrphanWebhookEvents(opts?: { windowHours?: number }): Promise<ReplaySummary> {
  const windowHours = opts?.windowHours ?? 25;
  const summary: ReplaySummary = {
    scanned: 0,
    notionReplayed: 0,
    todoistReplayed: 0,
    skipped: 0,
    errors: [],
  };

  // --- Notion ---
  const notionOrphans = await findOrphans("webhook-notion", NOTION_COMPLETION_OPS, windowHours);
  for (const { fingerprint, payload } of notionOrphans) {
    summary.scanned++;
    const pageIds = Array.isArray(payload?.pageIds)
      ? (payload!.pageIds as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    if (!pageIds.length || !process.env.NOTION_TOKEN) {
      summary.skipped++;
      continue;
    }
    try {
      const result = await syncNotionEntitiesByIds(pageIds);
      for (const id of pageIds) {
        try {
          await mirrorTodoistFromNotion(id);
        } catch (e) {
          await logAudit({
            source: "webhook-notion",
            op: "replay_mirror_error",
            payload: { id, fingerprint },
            error: (e as Error).message,
          });
        }
      }
      await logAudit({
        source: "webhook-notion",
        op: "replay",
        payload: { fingerprint, pageIds, ...result },
      });
      summary.notionReplayed++;
    } catch (e) {
      const msg = (e as Error).message;
      summary.errors.push({ fingerprint, error: msg });
      await logAudit({
        source: "webhook-notion",
        op: "replay_error",
        payload: { fingerprint, pageIds },
        error: msg,
      });
    }
  }

  // --- Todoist ---
  const todoistOrphans = await findOrphans("webhook-todoist", TODOIST_COMPLETION_OPS, windowHours);
  for (const { fingerprint, payload } of todoistOrphans) {
    summary.scanned++;
    const eventName = typeof payload?.eventName === "string" ? (payload!.eventName as string) : "";
    const eventData =
      payload?.eventData && typeof payload.eventData === "object"
        ? (payload!.eventData as Record<string, unknown>)
        : {};

    if (!process.env.TODOIST_TOKEN) {
      summary.skipped++;
      continue;
    }

    try {
      if (eventName.startsWith("project:")) {
        const projectId = pickId(eventData, ["id", "project_id", "projectId"], "project");
        if (eventName === "project:deleted" && projectId) {
          await markTodoistProjectArchived(projectId);
          await logAudit({
            source: "webhook-todoist",
            op: "replay_project_deleted",
            payload: { fingerprint, projectId },
          });
        } else if (projectId) {
          const r = await syncTodoistProjectsByIds([projectId]);
          await logAudit({
            source: "webhook-todoist",
            op: "replay_project",
            payload: { fingerprint, projectId, ...r },
          });
        } else {
          summary.skipped++;
          continue;
        }
        summary.todoistReplayed++;
      } else if (eventName.startsWith("item:")) {
        const id = pickId(eventData, ["id", "item_id", "task_id"], "item");
        if (!id) {
          summary.skipped++;
          continue;
        }
        if (eventName === "item:deleted") {
          await deleteTodoistTaskCacheRow(id);
          await logAudit({
            source: "webhook-todoist",
            op: "replay_item_deleted",
            payload: { fingerprint, id },
          });
        } else {
          const completed = eventName === "item:completed";
          const r = await syncTodoistTasksByIds([id], {
            assumedCompletedIds: completed ? new Set([id]) : undefined,
          });
          try {
            await mirrorNotionFromTodoist(id);
          } catch (e) {
            await logAudit({
              source: "webhook-todoist",
              op: "replay_mirror_error",
              payload: { id, fingerprint },
              error: (e as Error).message,
            });
          }
          await logAudit({
            source: "webhook-todoist",
            op: "replay",
            payload: { fingerprint, eventName, id, ...r },
          });
        }
        summary.todoistReplayed++;
      } else {
        summary.skipped++;
      }
    } catch (e) {
      const msg = (e as Error).message;
      summary.errors.push({ fingerprint, error: msg });
      await logAudit({
        source: "webhook-todoist",
        op: "replay_error",
        payload: { fingerprint, eventName },
        error: msg,
      });
    }
  }

  await logAudit({
    source: "reconcile",
    op: "replay_run",
    payload: summary as unknown as Record<string, unknown>,
  });

  return summary;
}
