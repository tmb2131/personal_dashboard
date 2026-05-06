import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { logAudit } from "@/lib/sync/audit";
import { mirrorTodoistFromNotion } from "@/lib/sync/orchestrator";
import { syncNotion, syncNotionEntitiesByIds } from "@/lib/sync/notion";
import {
  MAX_WEBHOOK_BODY_BYTES,
  collectNotionPageIdsFromPayload,
} from "@/lib/sync/webhook-utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();
  if (body.length > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const secret = process.env.NOTION_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers.get("x-notion-signature") ?? "";
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
    if (!safeEqual(sig, expected)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    await logAudit({ source: "webhook-notion", op: "parse_error", error: "invalid json" });
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (json.verification_token && typeof json.verification_token === "string") {
    return NextResponse.json({ verification_token: json.verification_token });
  }

  const pageIds = collectNotionPageIdsFromPayload(json);

  try {
    if (pageIds.length && process.env.NOTION_TOKEN) {
      await syncNotionEntitiesByIds(pageIds);
      for (const id of pageIds) {
        try {
          await mirrorTodoistFromNotion(id);
        } catch (e) {
          await logAudit({
            source: "webhook-notion",
            op: "mirror_error",
            payload: { id },
            error: (e as Error).message,
          });
        }
      }
      await logAudit({ source: "webhook-notion", op: "incremental", payload: { pageIds } });
    } else {
      await syncNotion();
      await logAudit({
        source: "webhook-notion",
        op: pageIds.length ? "full_sync_no_token" : "full_sync_fallback",
        payload: { pageIds },
      });
    }
  } catch (e) {
    const err = (e as Error).message;
    await logAudit({ source: "webhook-notion", op: "incremental_error", error: err });
    try {
      await syncNotion();
      await logAudit({ source: "webhook-notion", op: "full_sync_recover" });
    } catch (e2) {
      await logAudit({ source: "webhook-notion", op: "full_sync_failed", error: (e2 as Error).message });
    }
  }

  return NextResponse.json({ ok: true });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
