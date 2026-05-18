import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/sync/audit";
import { ensureGcalWatchesHealthy } from "@/lib/sync/gcal";
import { replayOrphanWebhookEvents } from "@/lib/sync/orphan-replay";
import { reconcileAllLinks } from "@/lib/sync/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Auth: accepts either a signed-in dashboard session OR a Vercel cron request authenticated
 * via `Authorization: Bearer ${CRON_SECRET}`. Vercel injects this header automatically when
 * `CRON_SECRET` is set in the project env.
 *
 * One Hobby cron slot, so this route does triple duty:
 *   1. Renew GCal push channels (the daily probe — webhooks don't always arrive in time
 *      to renew on their own, and the cron path is the only thing that fires on schedule).
 *   2. Replay any orphaned webhook events (acked but never completed — e.g. mid-deploy).
 *   3. Drift-scan all task_links (the original reconcile pass).
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const isCron =
    !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "unauth" }, { status: 401 });
    }
  }

  let watchError: string | null = null;
  try {
    await ensureGcalWatchesHealthy();
  } catch (e) {
    watchError = (e as Error).message;
    await logAudit({
      source: "reconcile",
      op: "watch_health_error",
      error: watchError,
    });
  }

  const replay = await replayOrphanWebhookEvents();
  const summary = await reconcileAllLinks();
  return NextResponse.json({ ok: true, watchError, replay, ...summary });
}
