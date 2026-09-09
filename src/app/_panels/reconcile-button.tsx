"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { reconcileSyncAction, type ReconcileResult } from "@/app/actions";
import { Toast } from "./toast-stack";

type ReconcileToast = {
  kind: "success" | "warning" | "error";
  message: string;
};

function summarize(r: Extract<ReconcileResult, { ok: true }>): ReconcileToast {
  // The refresh mirrors Todoist-side edits into Notion before the drift scan
  // runs, so its count belongs in the same "→ Notion" total the scan reports —
  // otherwise a run whose only work happened there reads as "in sync".
  const toNotion = r.mirroredToNotion + r.refresh.mirroredFromTodoist;
  const wrote =
    r.mirroredToTodoist +
    toNotion +
    r.closedArchived +
    r.backfill.created +
    r.notionBackfill.created +
    r.adopted.adopted +
    r.refresh.recurringRepaired;
  const errorCount =
    r.errors.length +
    r.adopted.errors.length +
    r.backfill.errors.length +
    (r.backfill.error ? 1 : 0) +
    r.notionBackfill.errors.length +
    (r.notionBackfill.error ? 1 : 0);

  // Each backfill works through a capped batch per run and holds back anything
  // the other side looks to cover already. All of it has to be said out loud:
  // otherwise "in sync" reads as "every task reached the other app" when a
  // couple of dozen are still queued behind the cap.
  const notes: string[] = [];
  const remaining = r.backfill.remaining + r.notionBackfill.remaining;
  const heldBack = r.backfill.skippedTitleMatch + r.notionBackfill.skippedTitleMatch;
  if (remaining) notes.push(`${remaining} left — run again.`);
  if (heldBack) notes.push(`${heldBack} skipped: same title on both sides.`);
  // A stale cache is worth naming: everything below it was decided against the
  // last good copy rather than against what the app says right now.
  if (r.refresh.notionError) notes.push(`Notion refresh failed: ${r.refresh.notionError}.`);
  if (r.refresh.todoistError) notes.push(`Todoist refresh failed: ${r.refresh.todoistError}.`);
  if (r.backfill.error) notes.push(`Todoist backfill: ${r.backfill.error}.`);
  if (r.notionBackfill.error) notes.push(`Notion backfill: ${r.notionBackfill.error}.`);
  const suffix = notes.length ? ` ${notes.join(" ")}` : "";

  if (errorCount) {
    return {
      kind: "warning",
      message: `Reconcile: ${wrote} fixed, ${errorCount} error${errorCount === 1 ? "" : "s"}.${suffix}`,
    };
  }
  if (wrote === 0) {
    return {
      kind: "success",
      message: `Reconcile: ${r.scanned} pair${r.scanned === 1 ? "" : "s"} in sync.${suffix}`,
    };
  }
  const parts: string[] = [];
  if (r.backfill.created) parts.push(`${r.backfill.created} added to Todoist`);
  if (r.notionBackfill.created) parts.push(`${r.notionBackfill.created} added to Notion`);
  if (r.adopted.adopted) parts.push(`${r.adopted.adopted} relinked`);
  if (r.mirroredToTodoist) parts.push(`${r.mirroredToTodoist} → Todoist`);
  if (toNotion) parts.push(`${toNotion} → Notion`);
  if (r.closedArchived) parts.push(`${r.closedArchived} closed`);
  if (r.refresh.recurringRepaired) {
    parts.push(`${r.refresh.recurringRepaired} recurring repaired`);
  }
  return { kind: "success", message: `Reconcile: ${parts.join(", ")}.${suffix}` };
}

export function ReconcileButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ReconcileToast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const result = await reconcileSyncAction();
      if (!result.ok) {
        setToast({ kind: "error", message: `Reconcile failed: ${result.error}` });
        return;
      }
      setToast(summarize(result));
      router.refresh();
    } catch (e) {
      setToast({ kind: "error", message: `Reconcile failed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }, [router]);

  const toastStyle =
    toast?.kind === "success"
      ? "border-success/40 bg-success/10 text-success"
      : toast?.kind === "warning"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-danger/40 bg-danger/10 text-danger";

  return (
    <>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        aria-label={busy ? "Reconciling" : "Reconcile sync"}
        title={busy ? "Reconciling" : "Reconcile sync"}
        className={cn(
          "inline-flex h-7 items-center justify-center rounded-md border border-border bg-bg px-2.5 text-[11px] hover:bg-bg-elevated disabled:opacity-50",
          className,
        )}
      >
        {busy ? "Reconciling…" : "Reconcile"}
      </button>
      {toast ? <Toast className={toastStyle}>{toast.message}</Toast> : null}
    </>
  );
}
