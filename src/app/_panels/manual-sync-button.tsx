"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

type ManualSyncButtonProps = {
  size?: "sm" | "md";
  variant?: "label" | "icon";
  className?: string;
};

export function ManualSyncButton({
  size = "sm",
  variant = "label",
  className,
}: ManualSyncButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/sync/run", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        notion?: { ok?: boolean };
        todoist?: { ok?: boolean };
        gcal?: { ok?: boolean };
      };
      const hasAnyProviderSuccess =
        body.ok === true ||
        body.notion?.ok === true ||
        body.todoist?.ok === true ||
        body.gcal?.ok === true;
      if (res.status === 401) {
        setError("Sign in required");
        return;
      }
      if (!res.ok || !hasAnyProviderSuccess) {
        setError(body.error ?? `Sync failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }, [router]);

  const compact = size === "sm";
  const iconOnly = variant === "icon";

  return (
    <span className={cn("inline-flex flex-col items-start gap-0.5", className)}>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        aria-label={busy ? "Syncing" : "Sync now"}
        title={busy ? "Syncing" : "Sync now"}
        className={cn(
          "inline-flex items-center justify-center rounded-md border border-border bg-bg hover:bg-bg-elevated disabled:opacity-50",
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
