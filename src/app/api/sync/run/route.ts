import { NextResponse, type NextRequest } from "next/server";
import { auth, getGoogleAccessToken } from "@/lib/auth";
import { syncNotion } from "@/lib/sync/notion";
import { syncTodoist, type SyncTodoistResult } from "@/lib/sync/todoist";
import { reconcileTodoistSyncResult } from "@/lib/sync/todoist-reconcile";
import { ensureGcalWatchesHealthy, syncGcal } from "@/lib/sync/gcal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Auth: a signed-in dashboard session, OR a scheduler request authenticated
 * with `Authorization: Bearer ${CRON_SECRET}` (injected automatically by
 * Vercel cron) or `Authorization: Bearer ${SYNC_TRIGGER_SECRET}` (used by the
 * GitHub Actions background-sync schedule - Hobby Vercel crons can only fire
 * once a day, so the 30-minute cadence runs from GitHub).
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const schedulerSecrets = [
    process.env.CRON_SECRET,
    process.env.SYNC_TRIGGER_SECRET,
  ].filter((s): s is string => Boolean(s));
  const isScheduler =
    !!authHeader &&
    schedulerSecrets.some((s) => authHeader === `Bearer ${s}`);

  let accessToken: string | undefined;
  if (!isScheduler) {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
    // The Google token is read server-side from the encrypted session JWT; it
    // is never exposed on the client session object (see lib/auth.ts).
    accessToken = await getGoogleAccessToken(req);
  }
  const watchHealthBefore = process.env.GOOGLE_REFRESH_TOKEN
    ? await ensureGcalWatchesHealthy()
        .then((r) => ({ ok: true as const, ...r }))
        .catch((e) => ({ ok: false as const, error: (e as Error).message }))
    : { ok: false as const, skipped: "no-refresh-token" };

  // syncGcal prefers the server refresh token and only falls back to the
  // session token, so gate on either being present — a desktop-app session
  // carries no Google token at all and would otherwise skip Calendar silently.
  const canSyncGcal = Boolean(process.env.GOOGLE_REFRESH_TOKEN) || Boolean(accessToken);

  const results = await Promise.allSettled([
    syncNotion(),
    syncTodoist(),
    canSyncGcal
      ? syncGcal(async () => accessToken)
      : Promise.resolve({ events: 0, calendars: 0, skipped: "no-token" }),
  ]);
  const todoistReconciliation =
    results[1].status === "fulfilled"
      ? await reconcileTodoistSyncResult(
          results[1].value as SyncTodoistResult,
          "manual-sync-todoist",
        )
      : null;
  const watchHealthAfter = process.env.GOOGLE_REFRESH_TOKEN
    ? await ensureGcalWatchesHealthy()
        .then((r) => ({ ok: true as const, ...r }))
        .catch((e) => ({ ok: false as const, error: (e as Error).message }))
    : { ok: false as const, skipped: "no-refresh-token" };

  const notionResult = serializeResult(results[0]);
  const todoistResult = serializeResult(results[1]);
  const gcalResult = serializeResult(results[2]);
  const anySyncSucceeded = notionResult.ok || todoistResult.ok || gcalResult.ok;
  const status = anySyncSucceeded ? 200 : 500;

  return NextResponse.json(
    {
      ok: anySyncSucceeded,
      error: anySyncSucceeded ? undefined : "All sync providers failed",
      notion: notionResult,
      todoist: todoistResult,
      todoistReconciliation,
      gcal: gcalResult,
      gcalWatchHealthBefore: watchHealthBefore,
      gcalWatchHealthAfter: watchHealthAfter,
    },
    { status },
  );
}

// Vercel cron invokes routes with GET; the scheduler auth above covers both.
export const GET = POST;

function serializeResult(r: PromiseSettledResult<unknown>) {
  return r.status === "fulfilled"
    ? { ok: true, ...((r.value as object) ?? {}) }
    : { ok: false, error: String((r.reason as Error)?.message ?? r.reason) };
}
