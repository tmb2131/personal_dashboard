import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncNotion } from "@/lib/sync/notion";
import { syncTodoist, type SyncTodoistResult } from "@/lib/sync/todoist";
import { reconcileTodoistCompletionResult } from "@/lib/sync/todoist-reconcile";
import { ensureGcalWatchesHealthy, syncGcal } from "@/lib/sync/gcal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const accessToken = (session as typeof session & { accessToken?: string }).accessToken;
  const watchHealthBefore = process.env.GOOGLE_REFRESH_TOKEN
    ? await ensureGcalWatchesHealthy()
        .then((r) => ({ ok: true as const, ...r }))
        .catch((e) => ({ ok: false as const, error: (e as Error).message }))
    : { ok: false as const, skipped: "no-refresh-token" };

  const results = await Promise.allSettled([
    syncNotion(),
    syncTodoist(),
    accessToken ? syncGcal(async () => accessToken) : Promise.resolve({ events: 0, calendars: 0, skipped: "no-token" }),
  ]);
  const todoistReconciliation =
    results[1].status === "fulfilled"
      ? await reconcileTodoistCompletionResult(
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

function serializeResult(r: PromiseSettledResult<unknown>) {
  return r.status === "fulfilled"
    ? { ok: true, ...((r.value as object) ?? {}) }
    : { ok: false, error: String((r.reason as Error)?.message ?? r.reason) };
}
