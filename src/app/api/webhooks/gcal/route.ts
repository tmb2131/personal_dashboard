import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import {
  ensureGcalWatchesHealthy,
  getCalendarClientFromRefresh,
  syncGcalIncrementalForCalendar,
} from "@/lib/sync/gcal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Google Calendar push notifications (channel callbacks). */
export async function POST(req: NextRequest) {
  const channelId = req.headers.get("x-goog-channel-id");
  const resourceId = req.headers.get("x-goog-resource-id");
  const resourceState = req.headers.get("x-goog-resource-state");

  if (resourceState === "not_exists") {
    return NextResponse.json({ ok: true });
  }

  if (!channelId) {
    return NextResponse.json({ ok: true });
  }

  const [row] = await db
    .select()
    .from(schema.syncState)
    .where(eq(schema.syncState.channelId, channelId));
  if (!row?.source.startsWith("gcal:")) {
    await logAudit({
      source: "webhook-gcal",
      op: "unknown_channel",
      payload: { channelId },
    });
    return NextResponse.json({ ok: true });
  }
  if (row.resourceId && resourceId && row.resourceId !== resourceId) {
    await logAudit({
      source: "webhook-gcal",
      op: "stale_resource",
      payload: { channelId, resourceId, expectedResourceId: row.resourceId },
    });
    return NextResponse.json({ ok: true });
  }

  const calendarId = row.source.slice("gcal:".length);

  // Defer the actual sync via `after()` so Google sees a fast 200 ack. Vercel's
  // waitUntil keeps the function alive until the work completes.
  after(() => runGcalWebhookWork({ calendarId }));

  return NextResponse.json({ ok: true });
}

async function runGcalWebhookWork({ calendarId }: { calendarId: string }) {
  const cal = await getCalendarClientFromRefresh();
  if (!cal) {
    await logAudit({
      source: "webhook-gcal",
      op: "no_oauth",
      payload: { calendarId },
    });
    return;
  }

  try {
    const r = await syncGcalIncrementalForCalendar(cal, calendarId);
    await logAudit({
      source: "webhook-gcal",
      op: "incremental",
      payload: { calendarId, ...r },
    });
    try {
      await ensureGcalWatchesHealthy();
    } catch (e) {
      await logAudit({
        source: "webhook-gcal",
        op: "watch_health_error",
        payload: { calendarId },
        error: (e as Error).message,
      });
    }
  } catch (e) {
    await logAudit({
      source: "webhook-gcal",
      op: "error",
      payload: { calendarId },
      error: (e as Error).message,
    });
  }
}
