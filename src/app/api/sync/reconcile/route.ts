import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { reconcileAllLinks } from "@/lib/sync/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Auth: accepts either a signed-in dashboard session OR a Vercel cron request authenticated
 * via `Authorization: Bearer ${CRON_SECRET}`. Vercel injects this header automatically when
 * `CRON_SECRET` is set in the project env.
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

  const summary = await reconcileAllLinks();
  return NextResponse.json({ ok: true, ...summary });
}
