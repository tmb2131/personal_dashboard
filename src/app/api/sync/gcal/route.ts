import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  describeGcalError,
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
    // Refresh-token client first: the session access token is stored once at
    // sign-in and never refreshed (see lib/auth.ts), so it expires about an
    // hour into a 30-day session while the server refresh token keeps working.
    const accessToken = (session as typeof session & { accessToken?: string }).accessToken;
    const cal =
      (await getCalendarClientFromRefresh()) ??
      (accessToken ? getCalendarClientFromAccessToken(accessToken) : null);
    if (!cal) {
      return NextResponse.json({ ok: false, error: "No Google Calendar credentials configured" }, { status: 500 });
    }

    const result = await syncGcalIncrementalAll(cal);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: describeGcalError(e) }, { status: 500 });
  }
}
