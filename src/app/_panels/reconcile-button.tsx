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
  const wrote =
    r.mirroredToTodoist + r.mirroredToNotion + r.closedArchived + r.backfill.created;
  const errorCount = r.errors.length + r.backfill.errors.length + (r.backfill.error ? 1 : 0);

  // The backfill works through a capped batch per run and holds back anything an
  // unlinked Todoist task looks to cover already. Both have to be said out loud:
  // otherwise "in sync" reads as "your Notion task reached Todoist" when it didn't.
  const notes: string[] = [];
  if (r.backfill.remaining) notes.push(`${r.backfill.remaining} left — run again.`);
  if (r.backfill.skippedTitleMatch) {
    notes.push(`${r.backfill.skippedTitleMatch} skipped: same title already in Todoist.`);
  }
  if (r.backfill.error) notes.push(`Backfill: ${r.backfill.error}.`);
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
  if (r.mirroredToTodoist) parts.push(`${r.mirroredToTodoist} → Todoist`);
  if (r.mirroredToNotion) parts.push(`${r.mirroredToNotion} → Notion`);
  if (r.closedArchived) parts.push(`${r.closedArchived} closed`);
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
