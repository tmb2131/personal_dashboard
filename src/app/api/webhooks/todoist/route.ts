import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import { mirrorNotionFromTodoist, repairRecurringTodoistLink } from "@/lib/sync/orchestrator";
import {
  deleteTodoistTaskCacheRow,
  markTodoistProjectArchived,
  syncTodoist,
  syncTodoistProjectsByIds,
  syncTodoistTasksByIds,
} from "@/lib/sync/todoist";
import { reconcileTodoistCompletionResult } from "@/lib/sync/todoist-reconcile";
import { MAX_WEBHOOK_BODY_BYTES, isProductionRuntime, webhookFingerprint } from "@/lib/sync/webhook-utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.text();
  if (body.length > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const secret = process.env.TODOIST_WEBHOOK_SECRET;
  if (!secret && isProductionRuntime()) {
    await logAudit({
      source: "webhook-todoist",
      op: "missing_secret_rejected",
    });
    return NextResponse.json({ error: "webhook secret is required in production" }, { status: 503 });
  }
  if (secret) {
    const sig = req.headers.get("x-todoist-hmac-sha256") ?? "";
    const expected = crypto.createHmac("sha256", secret).update(body).digest("base64");
    if (!safeEqual(sig, expected)) {
      await logAudit({
        source: "webhook-todoist",
        op: "signature_invalid",
      });
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    await logAudit({ source: "webhook-todoist", op: "parse_error", error: "invalid json" });
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const eventName = typeof json.event_name === "string" ? json.event_name : "";
  const eventData =
    json.event_data && typeof json.event_data === "object"
      ? (json.event_data as Record<string, unknown>)
      : {};
  const fingerprint = webhookFingerprint(body);
  const [existing] = await db
    .select({ id: schema.auditLog.id })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.source, "webhook-todoist"),
        eq(schema.auditLog.op, "event_received"),
        sql`payload->>'fingerprint' = ${fingerprint}`,
        sql`${schema.auditLog.ts} > now() - interval '30 minutes'`,
      ),
    )
    .limit(1);
  if (existing) {
    await logAudit({
      source: "webhook-todoist",
      op: "duplicate_ignored",
      payload: { fingerprint, eventName },
    });
    return NextResponse.json({ ok: true });
  }
  await logAudit({
    source: "webhook-todoist",
    op: "event_received",
    // eventData is recorded so the orphan-replay path in the daily reconcile can
    // re-derive the project/item id without keeping the raw webhook body.
    payload: { fingerprint, eventName, eventData },
  });

  // Defer the heavy work via `after()` so we ack Todoist in <500ms. Vercel keeps
  // the function alive (waitUntil) until the callback resolves — work isn't cut
  // off mid-flight like the old `Promise.resolve().then(...)` pattern was.
  after(() => runTodoistWebhookWork({ eventName, eventData, fingerprint }));

  return NextResponse.json({ ok: true });
}

async function runTodoistWebhookWork({
  eventName,
  eventData,
  fingerprint,
}: {
  eventName: string;
  eventData: Record<string, unknown>;
  fingerprint: string;
}) {
  try {
    if (eventName.startsWith("project:")) {
      const projectId = extractTodoistProjectId(eventData);
      if (eventName === "project:deleted" && projectId) {
        await markTodoistProjectArchived(projectId);
        await logAudit({
          source: "webhook-todoist",
          op: "project_deleted",
          payload: { eventName, fingerprint, projectId },
        });
        return;
      }
      if (!projectId || !process.env.TODOIST_TOKEN) {
        // No id to target / no creds — fall back to a full sync as last resort.
        const result = await syncTodoist();
        await reconcileTodoistCompletionResult(result, "webhook-todoist");
        await logAudit({
          source: "webhook-todoist",
          op: "full_sync_fallback",
          payload: { eventName, fingerprint, reason: projectId ? "no_token" : "no_project_id" },
        });
        return;
      }
      const r = await syncTodoistProjectsByIds([projectId]);
      await logAudit({
        source: "webhook-todoist",
        op: "incremental_project",
        payload: { eventName, fingerprint, projectId, ...r },
      });
      return;
    }

    if (eventName.startsWith("item:")) {
      const id = extractTodoistTaskId(eventData);
      if (eventName === "item:deleted" && id) {
        await deleteTodoistTaskCacheRow(id);
        await logAudit({
          source: "webhook-todoist",
          op: "item_deleted",
          payload: { id, fingerprint },
        });
        return;
      }

      if (!id || !process.env.TODOIST_TOKEN) {
        const result = await syncTodoist();
        await reconcileTodoistCompletionResult(result, "webhook-todoist");
        await logAudit({
          source: "webhook-todoist",
          op: "full_sync_fallback",
          payload: { eventName, fingerprint, reason: id ? "no_token" : "no_item_id" },
        });
        return;
      }

      const [before] = await db
        .select()
        .from(schema.todoistTasks)
        .where(eq(schema.todoistTasks.id, id));

      const completed = eventName === "item:completed";
      const syncResult = await syncTodoistTasksByIds([id], {
        assumedCompletedIds: completed ? new Set([id]) : undefined,
      });

      try {
        // Mirror completion against the original task id first. For recurring tasks, repairing the
        // link before mirroring points to the new open instance and prevents the completed status
        // from propagating to the app.
        await mirrorNotionFromTodoist(id);
      } catch (e) {
        await logAudit({
          source: "webhook-todoist",
          op: "mirror_error",
          payload: { id, eventName, fingerprint },
          error: (e as Error).message,
        });
      }

      let repairedTodoistTaskId: string | undefined;
      if (completed && before?.dueIsRecurring) {
        const rep = await repairRecurringTodoistLink(id);
        if (rep.repaired) repairedTodoistTaskId = rep.newTodoistTaskId;
      }

      await logAudit({
        source: "webhook-todoist",
        op: "incremental",
        payload: { eventName, id, fingerprint, repairedTodoistTaskId, ...syncResult },
      });
      return;
    }

    const result = await syncTodoist();
    await reconcileTodoistCompletionResult(result, "webhook-todoist");
    await logAudit({
      source: "webhook-todoist",
      op: "full_sync_unknown_event",
      payload: { eventName, fingerprint },
    });
  } catch (e) {
    await logAudit({
      source: "webhook-todoist",
      op: "error",
      payload: { eventName, fingerprint },
      error: (e as Error).message,
    });
  }
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function todoistIdToString(id: unknown): string | undefined {
  if (typeof id === "string" && id.trim()) return id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return undefined;
}

function extractTodoistProjectId(eventData: Record<string, unknown>): string | undefined {
  const direct =
    todoistIdToString(eventData.id) ??
    todoistIdToString(eventData.project_id) ??
    todoistIdToString(eventData.projectId);
  if (direct) return direct;

  const nestedProject = eventData.project;
  if (nestedProject && typeof nestedProject === "object") {
    const nested = nestedProject as Record<string, unknown>;
    const nestedId = todoistIdToString(nested.id) ?? todoistIdToString(nested.project_id);
    if (nestedId) return nestedId;
  }
  return undefined;
}

function extractTodoistTaskId(eventData: Record<string, unknown>): string | undefined {
  const direct =
    todoistIdToString(eventData.id) ??
    todoistIdToString(eventData.item_id) ??
    todoistIdToString(eventData.task_id);
  if (direct) return direct;

  const nestedItem = eventData.item;
  if (nestedItem && typeof nestedItem === "object") {
    const nested = nestedItem as Record<string, unknown>;
    const nestedId =
      todoistIdToString(nested.id) ??
      todoistIdToString(nested.item_id) ??
      todoistIdToString(nested.task_id);
    if (nestedId) return nestedId;
  }

  return undefined;
}
