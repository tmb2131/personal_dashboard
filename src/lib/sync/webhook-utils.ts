/** Max webhook body size (bytes) to limit accidental large payloads. */
export const MAX_WEBHOOK_BODY_BYTES = 600_000;

export function collectNotionPageIdsFromPayload(body: Record<string, unknown>): string[] {
  const ids: string[] = [];

  const push = (id: unknown) => {
    if (typeof id === "string" && id.length > 8) ids.push(id);
  };

  if (body.entity && typeof body.entity === "object") {
    const e = body.entity as { id?: string };
    push(e.id);
  }

  const data = body.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (d.object === "page" || d.object === "data_source") push(d.id);
    if (typeof d.parent === "object" && d.parent !== null) {
      const p = d.parent as { id?: string };
      push(p.id);
    }
  }

  if (Array.isArray(body.events)) {
    for (const ev of body.events) {
      if (ev && typeof ev === "object") {
        const e = ev as { entity?: { id?: string }; id?: string };
        push(e.entity?.id);
        push(e.id);
      }
    }
  }

  if (body.record && typeof body.record === "object") {
    const r = body.record as { id?: string };
    push(r.id);
  }

  return [...new Set(ids)];
}
