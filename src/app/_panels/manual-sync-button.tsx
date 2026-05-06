"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

type ManualSyncButtonProps = {
  size?: "sm" | "md";
  className?: string;
};

export function ManualSyncButton({ size = "sm", className }: ManualSyncButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/sync/run", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 401) {
        setError("Sign in required");
        return;
      }
      if (!res.ok) {
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

  return (
    <span className={cn("inline-flex flex-col items-start gap-0.5", className)}>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className={cn(
          "inline-flex items-center justify-center rounded-md border border-border bg-bg hover:bg-bg-elevated disabled:opacity-50",
          compact ? "h-7 px-2.5 text-[11px]" : "h-9 px-4 text-sm",
        )}
      >
        {busy ? "Syncing…" : "Sync now"}
      </button>
      {error ? (
        <span className={cn("max-w-[14rem] [color:var(--dot-family)]", compact ? "text-[10px]" : "text-[11px]")}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
