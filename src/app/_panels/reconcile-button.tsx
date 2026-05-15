"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { reconcileSyncAction, type ReconcileResult } from "@/app/actions";

type ReconcileToast = {
  kind: "success" | "warning" | "error";
  message: string;
};

function summarize(r: Extract<ReconcileResult, { ok: true }>): ReconcileToast {
  const wrote = r.mirroredToTodoist + r.mirroredToNotion + r.closedArchived;
  const hasErrors = r.errors.length > 0;
  if (hasErrors) {
    return {
      kind: "warning",
      message: `Reconcile: ${wrote} fixed, ${r.errors.length} error${r.errors.length === 1 ? "" : "s"}.`,
    };
  }
  if (wrote === 0) {
    return { kind: "success", message: `Reconcile: ${r.scanned} pair${r.scanned === 1 ? "" : "s"} in sync.` };
  }
  const parts: string[] = [];
  if (r.mirroredToTodoist) parts.push(`${r.mirroredToTodoist} → Todoist`);
  if (r.mirroredToNotion) parts.push(`${r.mirroredToNotion} → Notion`);
  if (r.closedArchived) parts.push(`${r.closedArchived} closed`);
  return { kind: "success", message: `Reconcile: ${parts.join(", ")}.` };
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
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : toast?.kind === "warning"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
        : "border-red-500/40 bg-red-500/10 text-red-200";

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
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "pointer-events-none fixed right-4 bottom-4 z-50 max-w-[28rem] rounded-md border px-3 py-2 text-[12px] shadow-lg backdrop-blur",
            toastStyle,
          )}
        >
          {toast.message}
        </div>
      ) : null}
    </>
  );
}
