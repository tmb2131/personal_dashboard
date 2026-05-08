import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getCalendarClientFromAccessToken,
  getCalendarClientFromRefresh,
  syncGcalIncrementalAll,
} from "@/lib/sync/gcal";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });

  try {
    const accessToken = (session as typeof session & { accessToken?: string }).accessToken;
    const cal = accessToken
      ? getCalendarClientFromAccessToken(accessToken)
      : await getCalendarClientFromRefresh();
    if (!cal) {
      return NextResponse.json({ ok: false, error: "No Google Calendar credentials configured" }, { status: 500 });
    }

    const result = await syncGcalIncrementalAll(cal);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
