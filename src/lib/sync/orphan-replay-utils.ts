/**
 * Pure helpers for the orphan-replay path. Split out so they can be unit-tested
 * without importing `@/lib/db` (vitest doesn't resolve the path alias and the
 * Drizzle/Neon client has side effects at import time).
 */

/** Ops we treat as evidence the webhook ran to completion. */
export const NOTION_COMPLETION_OPS = new Set([
  "incremental",
  "full_sync_fallback",
  "full_sync_recover",
  "full_sync_failed",
  "skipped_no_token",
]);

export const TODOIST_COMPLETION_OPS = new Set([
  "incremental",
  "incremental_project",
  "full_sync_fallback",
  "full_sync_unknown_event",
  "item_deleted",
  "project_deleted",
  "error",
]);

export type AuditRowPayload = Record<string, unknown> | null;
export type AuditRowLite = { op: string; payload: AuditRowPayload };

/**
 * Given audit rows for one webhook source, return the `event_received`
 * fingerprints that have no paired completion row.
 */
export function pairOrphans(
  rows: AuditRowLite[],
  completionOps: Set<string>,
): { fingerprint: string; payload: AuditRowPayload }[] {
  const received = new Map<string, AuditRowPayload>();
  const completedFingerprints = new Set<string>();

  for (const row of rows) {
    const payload = (row.payload as AuditRowPayload) ?? null;
    const fingerprint =
      payload && typeof payload === "object" && typeof payload.fingerprint === "string"
        ? (payload.fingerprint as string)
        : null;
    if (!fingerprint) continue;

    if (row.op === "event_received") {
      received.set(fingerprint, payload);
    } else if (completionOps.has(row.op) || row.op === "replay") {
      completedFingerprints.add(fingerprint);
    }
  }

  const orphans: { fingerprint: string; payload: AuditRowPayload }[] = [];
  for (const [fingerprint, payload] of received) {
    if (!completedFingerprints.has(fingerprint)) orphans.push({ fingerprint, payload });
  }
  return orphans;
}

export function pickId(
  data: Record<string, unknown>,
  keys: string[],
  nestedKey: "project" | "item",
): string | undefined {
  const fromKeys = (obj: Record<string, unknown>) => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.trim()) return v;
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
    return undefined;
  };
  const direct = fromKeys(data);
  if (direct) return direct;
  const nested = data[nestedKey];
  if (nested && typeof nested === "object") return fromKeys(nested as Record<string, unknown>);
  return undefined;
}
