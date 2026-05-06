import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncNotion } from "@/lib/sync/notion";
import { syncTodoist } from "@/lib/sync/todoist";
import { syncGcal } from "@/lib/sync/gcal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const accessToken = (session as typeof session & { accessToken?: string }).accessToken;

  const results = await Promise.allSettled([
    syncNotion(),
    syncTodoist(),
    accessToken ? syncGcal(async () => accessToken) : Promise.resolve({ events: 0, calendars: 0, skipped: "no-token" }),
  ]);

  return NextResponse.json({
    notion: serializeResult(results[0]),
    todoist: serializeResult(results[1]),
    gcal: serializeResult(results[2]),
  });
}

function serializeResult(r: PromiseSettledResult<unknown>) {
  return r.status === "fulfilled"
    ? { ok: true, ...((r.value as object) ?? {}) }
    : { ok: false, error: String((r.reason as Error)?.message ?? r.reason) };
}
