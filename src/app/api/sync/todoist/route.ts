import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncTodoist } from "@/lib/sync/todoist";
import { reconcileTodoistCompletionResult } from "@/lib/sync/todoist-reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  if (!process.env.TODOIST_TOKEN) {
    return NextResponse.json({ ok: false, error: "TODOIST_TOKEN missing" }, { status: 500 });
  }

  try {
    const result = await syncTodoist();
    const reconciliation = await reconcileTodoistCompletionResult(result, "todoist-auto-sync");
    const changed =
      result.changedTaskIds.length > 0 ||
      result.completedTaskIds.length > 0 ||
      reconciliation.mirrored > 0 ||
      reconciliation.repaired > 0;

    return NextResponse.json({ ok: true, changed, ...result, reconciliation });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
