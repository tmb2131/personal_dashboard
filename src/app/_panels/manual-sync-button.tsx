"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type ManualSyncButtonProps = {
  size?: "sm" | "md";
  variant?: "label" | "icon";
  className?: string;
};

type SyncProviderResult = { ok?: boolean; error?: string };

type SyncRunResponse = {
  ok?: boolean;
  error?: string;
  notion?: SyncProviderResult;
  todoist?: SyncProviderResult;
  gcal?: SyncProviderResult;
};

type SyncToast = {
  kind: "success" | "warning" | "error";
  message: string;
  details?: string[];
};

export function ManualSyncButton({
  size = "sm",
  variant = "label",
  className,
}: ManualSyncButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<SyncToast | null>(null);
  const [showToastDetails, setShowToastDetails] = useState(false);

  useEffect(() => {
    if (!toast || showToastDetails) return;
    const t = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(t);
  }, [toast, showToastDetails]);

  const run = useCallback(async () => {
    setError(null);
    setShowToastDetails(false);
    setBusy(true);
    try {
      const res = await fetch("/api/sync/run", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as SyncRunResponse;
      const providers = [
        { key: "notion", label: "Notion", ok: body.notion?.ok === true },
        { key: "todoist", label: "Todoist", ok: body.todoist?.ok === true },
        { key: "gcal", label: "GCal", ok: body.gcal?.ok === true },
      ] as const;
      const succeeded = providers.filter((p) => p.ok).map((p) => p.label);
      const failed = providers.filter((p) => !p.ok).map((p) => p.label);
      const detailLines = providers.flatMap((p) => {
        const provider = body[p.key];
        if (provider?.ok === false && provider.error) return [`${p.label}: ${provider.error}`];
        return [];
      });
      const hasAnyProviderSuccess = succeeded.length > 0 || body.ok === true;
      if (res.status === 401) {
        setError("Sign in required");
        setToast({ kind: "error", message: "Sync failed: sign in required.", details: detailLines });
        return;
      }
      if (!res.ok || !hasAnyProviderSuccess) {
        const message = body.error ?? `Sync failed (${res.status})`;
        setError(message);
        setToast({ kind: "error", message: `Sync failed: ${message}`, details: detailLines });
        return;
      }
      const successToast =
        failed.length === 0
          ? "Sync complete: all providers succeeded."
          : `Partial sync: ${succeeded.join(", ")} succeeded; ${failed.join(", ")} failed.`;
      setToast({
        kind: failed.length === 0 ? "success" : "warning",
        message: successToast,
        details: detailLines,
      });
      router.refresh();
    } catch {
      setError("Network error");
      setToast({ kind: "error", message: "Sync failed: network error." });
    } finally {
      setBusy(false);
    }
  }, [router]);

  const compact = size === "sm";
  const iconOnly = variant === "icon";
  const toastStyle = useMemo(
    () =>
      toast?.kind === "success"
        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
        : toast?.kind === "warning"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
          : "border-red-500/40 bg-red-500/10 text-red-200",
    [toast],
  );

  return (
    <>
      <span className={cn("inline-flex flex-col items-start gap-0.5", className)}>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          aria-label={busy ? "Syncing" : "Sync now"}
          title={busy ? "Syncing" : "Sync now"}
          className={cn(
            "inline-flex items-center justify-center rounded-md border border-border bg-bg",
            "transition-colors duration-200 ease-out motion-reduce:duration-0",
            "hover:bg-bg-elevated motion-safe:active:scale-[0.98] disabled:opacity-50 disabled:motion-safe:active:scale-100",
            iconOnly ? (compact ? "h-7 w-7" : "h-9 w-9") : compact ? "h-7 px-2.5 text-[11px]" : "h-9 px-4 text-sm",
          )}
        >
          {iconOnly ? (
            <SyncGlyph className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", busy ? "animate-spin" : "")} />
          ) : busy ? (
            "Syncing…"
          ) : (
            "Sync now"
          )}
        </button>
        {error ? (
          <span className={cn("max-w-[14rem] [color:var(--dot-family)]", compact ? "text-[10px]" : "text-[11px]")}>
            {error}
          </span>
        ) : null}
      </span>
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "pointer-events-none fixed right-4 bottom-4 z-50 max-w-[28rem] rounded-md border px-3 py-2 text-[12px] shadow-lg backdrop-blur",
            toastStyle,
          )}
        >
          <div>{toast.message}</div>
          {toast.details && toast.details.length > 0 ? (
            <div className="mt-1.5">
              <button
                type="button"
                className="pointer-events-auto underline decoration-dotted underline-offset-2"
                onClick={() => setShowToastDetails((v) => !v)}
              >
                {showToastDetails ? "Hide details" : "View details"}
              </button>
              {showToastDetails ? (
                <ul className="mt-1.5 list-disc pl-4 text-[11px] text-fg-muted">
                  {toast.details.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function SyncGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <path d="M21 12a9 9 0 0 0-15.3-6.3L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 15.3 6.3L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}
