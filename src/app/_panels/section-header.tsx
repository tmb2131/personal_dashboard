"use client";

import { useEffect, useState } from "react";
import type { SourceKey } from "@/lib/dashboard-data";
import { dotClassFor, formatAgo, freshnessFor } from "@/lib/freshness";
import { cn } from "@/lib/utils";
import { useDashboardMeta } from "./dashboard-meta-context";
import { useSyncStatus } from "./sync-status-context";

export function SectionHeader({
  eyebrow,
  title,
  count,
  source,
  sourceKey,
  className,
  children,
}: {
  eyebrow: string;
  title: string;
  count?: string | number;
  source?: string;
  sourceKey?: SourceKey;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-5 pb-3 text-[11px] tracking-[0.14em] text-fg-subtle sm:px-5",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="uppercase">{eyebrow}</span>
        {title && <span>·</span>}
        <span className="uppercase text-fg">{title}</span>
        {count !== undefined && count !== "" && (
          <span className="ml-1.5 tabular-nums text-fg-muted normal-case tracking-normal">{count}</span>
        )}
      </div>
      <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-3 normal-case tracking-normal">
        {children}
        {sourceKey ? (
          <SourceFreshness label={source ?? sourceKey} sourceKey={sourceKey} />
        ) : (
          source && <span className="text-fg-subtle">{source}</span>
        )}
      </div>
    </div>
  );
}

function SourceFreshness({
  label,
  sourceKey,
}: {
  label: string;
  sourceKey: SourceKey;
}) {
  const meta = useDashboardMeta();
  const { errorBySource, retryingBySource, retrySource, inFlight } = useSyncStatus();
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(i);
  }, []);

  const health = meta?.sources?.[sourceKey] ?? { lastSyncAt: null };
  const error = errorBySource[sourceKey];
  const retrying = retryingBySource[sourceKey] ?? false;
  const freshness = freshnessFor(health, now);
  const hasError = Boolean(error);
  const dot = dotClassFor(freshness, hasError);
  const ago = formatAgo(health.lastSyncAt, now);
  const tooltip = hasError ? `${label}: ${error}` : `${label} · ${ago}`;

  return (
    <span
      title={tooltip}
      className={cn(
        "inline-flex items-center gap-1.5 text-fg-subtle",
        hasError && "text-danger",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          dot,
          (inFlight || retrying) && "motion-safe:animate-pulse",
        )}
        aria-hidden="true"
      />
      <span>{label}</span>
      {hasError ? (
        <button
          type="button"
          onClick={() => void retrySource(sourceKey)}
          disabled={retrying}
          className="ml-0.5 underline decoration-dotted underline-offset-2 transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg disabled:opacity-50"
        >
          {retrying ? "retrying…" : "retry"}
        </button>
      ) : freshness === "stale" ? (
        <span className="ml-0.5 text-warning tabular-nums">{ago}</span>
      ) : freshness === "unknown" ? null : (
        <span className="ml-0.5 tabular-nums">{ago}</span>
      )}
    </span>
  );
}
