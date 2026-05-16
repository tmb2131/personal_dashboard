import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import { mirrorTodoistFromNotion } from "@/lib/sync/orchestrator";
import { syncNotion, syncNotionEntitiesByIds } from "@/lib/sync/notion";
import {
  MAX_WEBHOOK_BODY_BYTES,
  collectNotionEventIdsFromPayload,
  collectNotionPageIdsFromPayload,
  isProductionRuntime,
  webhookFingerprint,
} from "@/lib/sync/webhook-utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();
  if (body.length > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    await logAudit({ source: "webhook-notion", op: "parse_error", error: "invalid json" });
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // Verification handshake runs before signature enforcement: at setup time
  // the signing secret doesn't exist yet, and the handshake request has no
  // signature header to verify.
  if (json.verification_token && typeof json.verification_token === "string") {
    console.log("[notion-webhook] verification_token:", json.verification_token);
    return NextResponse.json({ verification_token: json.verification_token });
  }

  const secret = process.env.NOTION_WEBHOOK_SECRET;
  if (!secret && isProductionRuntime()) {
    await logAudit({
      source: "webhook-notion",
      op: "missing_secret_rejected",
    });
    return NextResponse.json({ error: "webhook secret is required in production" }, { status: 503 });
  }
  if (secret) {
    const sig = req.headers.get("x-notion-signature") ?? "";
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
    if (!safeEqual(sig, expected)) {
      await logAudit({
        source: "webhook-notion",
        op: "signature_invalid",
      });
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  const pageIds = collectNotionPageIdsFromPayload(json);
  const eventIds = collectNotionEventIdsFromPayload(json);
  const fingerprint = webhookFingerprint(body);
  const [existing] = await db
    .select({ id: schema.auditLog.id })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.source, "webhook-notion"),
        eq(schema.auditLog.op, "event_received"),
        sql`payload->>'fingerprint' = ${fingerprint}`,
        sql`coalesce(payload->>'eventId', '') = ${eventIds[0] ?? ""}`,
        sql`${schema.auditLog.ts} > now() - interval '30 minutes'`,
      ),
    )
    .limit(1);
  if (existing) {
    await logAudit({
      source: "webhook-notion",
      op: "duplicate_ignored",
      payload: { fingerprint, eventIds, pageIds },
    });
    return NextResponse.json({ ok: true });
  }

  await logAudit({
    source: "webhook-notion",
    op: "event_received",
    payload: { fingerprint, eventId: eventIds[0] ?? null, eventIds, pageIds },
  });

  runNotionWebhookWork({
    pageIds,
    eventIds,
    fingerprint,
  });

  return NextResponse.json({ ok: true });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function runNotionWebhookWork({
  pageIds,
  eventIds,
  fingerprint,
}: {
  pageIds: string[];
  eventIds: string[];
  fingerprint: string;
}) {
  const limitedPageIds = pageIds.slice(0, 40);
  void Promise.resolve().then(async () => {
    await logAudit({
      source: "webhook-notion",
      op: "processing_started",
      payload: {
        fingerprint,
        eventId: eventIds[0] ?? null,
        eventIds,
        pageIds: limitedPageIds,
        droppedPageIds: Math.max(pageIds.length - limitedPageIds.length, 0),
      },
    });

    try {
      if (limitedPageIds.length && process.env.NOTION_TOKEN) {
        await syncNotionEntitiesByIds(limitedPageIds);
        for (const id of limitedPageIds) {
          try {
            await mirrorTodoistFromNotion(id);
          } catch (e) {
            await logAudit({
              source: "webhook-notion",
              op: "mirror_error",
              payload: { id, fingerprint, eventId: eventIds[0] ?? null },
              error: (e as Error).message,
            });
          }
        }
        await logAudit({
          source: "webhook-notion",
          op: "incremental",
          payload: { pageIds: limitedPageIds, fingerprint, eventId: eventIds[0] ?? null },
        });
      } else {
        await syncNotion();
        await logAudit({
          source: "webhook-notion",
          op: limitedPageIds.length ? "full_sync_no_token" : "full_sync_fallback",
          payload: { pageIds: limitedPageIds, fingerprint, eventId: eventIds[0] ?? null },
        });
      }
    } catch (e) {
      const err = (e as Error).message;
      await logAudit({
        source: "webhook-notion",
        op: "incremental_error",
        payload: { fingerprint, eventId: eventIds[0] ?? null },
        error: err,
      });
      try {
        await syncNotion();
        await logAudit({
          source: "webhook-notion",
          op: "full_sync_recover",
          payload: { fingerprint, eventId: eventIds[0] ?? null },
        });
      } catch (e2) {
        await logAudit({
          source: "webhook-notion",
          op: "full_sync_failed",
          payload: { fingerprint, eventId: eventIds[0] ?? null },
          error: (e2 as Error).message,
        });
      }
    }
  });
}
