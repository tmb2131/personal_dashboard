import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { syncTodoist } from "@/lib/sync/todoist";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();

  const secret = process.env.TODOIST_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers.get("x-todoist-hmac-sha256") ?? "";
    const expected = crypto.createHmac("sha256", secret).update(body).digest("base64");
    if (!safeEqual(sig, expected)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  await syncTodoist().catch(() => {});
  return NextResponse.json({ ok: true });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
