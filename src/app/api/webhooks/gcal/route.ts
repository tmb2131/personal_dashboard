import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import {
  getCalendarClientFromRefresh,
  syncGcalIncrementalForCalendar,
} from "@/lib/sync/gcal";

export const dynamic = "force-dynamic";

/** Google Calendar push notifications (channel callbacks). */
export async function POST(req: NextRequest) {
  const channelId = req.headers.get("x-goog-channel-id");
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

  const calendarId = row.source.slice("gcal:".length);
  const cal = await getCalendarClientFromRefresh();
  if (!cal) {
    await logAudit({
      source: "webhook-gcal",
      op: "no_oauth",
      payload: { calendarId },
    });
    return NextResponse.json({ ok: true });
  }

  try {
    const r = await syncGcalIncrementalForCalendar(cal, calendarId);
    await logAudit({
      source: "webhook-gcal",
      op: "incremental",
      payload: { calendarId, ...r },
    });
  } catch (e) {
    await logAudit({
      source: "webhook-gcal",
      op: "error",
      payload: { calendarId },
      error: (e as Error).message,
    });
  }

  return NextResponse.json({ ok: true });
}
