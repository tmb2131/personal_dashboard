import { NextResponse, type NextRequest } from "next/server";
import { syncNotion } from "@/lib/sync/notion";
import { syncTodoist } from "@/lib/sync/todoist";

// Vercel Cron hits this endpoint on a schedule (configured in vercel.json).
// Auth: header `Authorization: Bearer ${CRON_SECRET}` set via Vercel project env.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = req.headers.get("authorization");
    if (got !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauth" }, { status: 401 });
    }
  }

  // GCal sync needs a user OAuth token — done elsewhere via stored refresh token.
  // M3 will pick that up. For now we just refresh the two token-only sources.
  const results = await Promise.allSettled([syncNotion(), syncTodoist()]);
  return NextResponse.json({
    notion: r(results[0]),
    todoist: r(results[1]),
  });
}

function r(x: PromiseSettledResult<unknown>) {
  return x.status === "fulfilled"
    ? { ok: true, ...((x.value as object) ?? {}) }
    : { ok: false, error: String((x.reason as Error)?.message ?? x.reason) };
}
