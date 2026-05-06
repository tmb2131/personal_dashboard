import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { renewGcalWatchesIfNeeded } from "@/lib/sync/gcal";

export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Renew Google Calendar push channels before they expire (Vercel Cron or manual). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const vercelCron = req.headers.get("x-vercel-cron") === "1";
  const bearer = req.headers.get("authorization")?.startsWith("Bearer ")
    ? req.headers.get("authorization")!.slice(7)
    : "";
  const authorized =
    process.env.NODE_ENV === "development" ||
    (secret && bearer && timingSafeEqual(bearer, secret)) ||
    (!secret && vercelCron && process.env.VERCEL === "1");
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await renewGcalWatchesIfNeeded();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
