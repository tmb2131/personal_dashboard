import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import { mirrorNotionFromTodoist, repairRecurringTodoistLink } from "@/lib/sync/orchestrator";
import {
  deleteTodoistTaskCacheRow,
  syncTodoist,
  syncTodoistTasksByIds,
} from "@/lib/sync/todoist";
import { reconcileTodoistCompletionResult } from "@/lib/sync/todoist-reconcile";
import { MAX_WEBHOOK_BODY_BYTES } from "@/lib/sync/webhook-utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();
  if (body.length > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const secret = process.env.TODOIST_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers.get("x-todoist-hmac-sha256") ?? "";
    const expected = crypto.createHmac("sha256", secret).update(body).digest("base64");
    if (!safeEqual(sig, expected)) {
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

  try {
    if (eventName.startsWith("project:")) {
      const result = await syncTodoist();
      await reconcileTodoistCompletionResult(result, "webhook-todoist");
      await logAudit({ source: "webhook-todoist", op: "full_sync_project", payload: { eventName } });
      return NextResponse.json({ ok: true });
    }

    if (eventName.startsWith("item:")) {
      const id = extractTodoistTaskId(eventData);
      if (eventName === "item:deleted" && id) {
        await deleteTodoistTaskCacheRow(id);
        await logAudit({ source: "webhook-todoist", op: "item_deleted", payload: { id } });
        return NextResponse.json({ ok: true });
      }

      if (!id || !process.env.TODOIST_TOKEN) {
        const result = await syncTodoist();
        await reconcileTodoistCompletionResult(result, "webhook-todoist");
        await logAudit({ source: "webhook-todoist", op: "full_sync_fallback", payload: { eventName } });
        return NextResponse.json({ ok: true });
      }

      const [before] = await db
        .select()
        .from(schema.todoistTasks)
        .where(eq(schema.todoistTasks.id, id));

      const completed = eventName === "item:completed";
      await syncTodoistTasksByIds([id], {
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
          payload: { id, eventName },
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
        payload: { eventName, id, repairedTodoistTaskId },
      });
      return NextResponse.json({ ok: true });
    }

    const result = await syncTodoist();
    await reconcileTodoistCompletionResult(result, "webhook-todoist");
    await logAudit({ source: "webhook-todoist", op: "full_sync_unknown_event", payload: { eventName } });
  } catch (e) {
    await logAudit({ source: "webhook-todoist", op: "error", error: (e as Error).message });
    try {
      const result = await syncTodoist();
      await reconcileTodoistCompletionResult(result, "webhook-todoist");
    } catch {
      /* logged */
    }
  }

  return NextResponse.json({ ok: true });
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
