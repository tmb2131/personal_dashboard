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
      await syncTodoist();
      await logAudit({ source: "webhook-todoist", op: "full_sync_project", payload: { eventName } });
      return NextResponse.json({ ok: true });
    }

    if (eventName.startsWith("item:")) {
      const id = typeof eventData.id === "string" ? eventData.id : undefined;
      if (eventName === "item:deleted" && id) {
        await deleteTodoistTaskCacheRow(id);
        await logAudit({ source: "webhook-todoist", op: "item_deleted", payload: { id } });
        return NextResponse.json({ ok: true });
      }

      if (!id || !process.env.TODOIST_TOKEN) {
        await syncTodoist();
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

      let mirrorId = id;
      if (completed && before?.dueIsRecurring) {
        const rep = await repairRecurringTodoistLink(id);
        if (rep.repaired && rep.newTodoistTaskId) mirrorId = rep.newTodoistTaskId;
      }

      try {
        await mirrorNotionFromTodoist(mirrorId);
      } catch (e) {
        await logAudit({
          source: "webhook-todoist",
          op: "mirror_error",
          payload: { id: mirrorId, eventName },
          error: (e as Error).message,
        });
      }

      await logAudit({
        source: "webhook-todoist",
        op: "incremental",
        payload: { eventName, id, mirrorId },
      });
      return NextResponse.json({ ok: true });
    }

    await syncTodoist();
    await logAudit({ source: "webhook-todoist", op: "full_sync_unknown_event", payload: { eventName } });
  } catch (e) {
    await logAudit({ source: "webhook-todoist", op: "error", error: (e as Error).message });
    try {
      await syncTodoist();
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
