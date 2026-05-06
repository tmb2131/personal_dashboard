import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { syncNotion } from "@/lib/sync/notion";

// Stub: receives the Notion subscription event, verifies HMAC, kicks off a re-sync.
// Real propagation logic (only updating affected pages) lands in M3.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();

  // TEMPORARY: delete after Notion subscription is verified — prints full payload in Vercel function logs.
  console.log("[notion-webhook DEBUG] POST body:", body);

  const secret = process.env.NOTION_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers.get("x-notion-signature") ?? "";
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
    if (!safeEqual(sig, expected)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  // Notion sends a `verification_token` on the first ping. Echo it back.
  try {
    const json = JSON.parse(body);
    if (json.verification_token) {
      return NextResponse.json({ verification_token: json.verification_token });
    }
  } catch {}

  // Naive: full re-sync. M3 will read the event and only patch affected rows.
  await syncNotion().catch(() => {});
  return NextResponse.json({ ok: true });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
