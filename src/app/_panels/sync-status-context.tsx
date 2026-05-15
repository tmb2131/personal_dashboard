"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { SourceKey } from "@/lib/dashboard-data";

type SyncErrorBySource = Partial<Record<SourceKey, string>>;

type SyncStatusValue = {
  inFlight: boolean;
  errorBySource: SyncErrorBySource;
  beginSync: () => void;
  endSync: (errors?: SyncErrorBySource) => void;
  clearError: (source: SourceKey) => void;
};

const SyncStatusContext = createContext<SyncStatusValue | null>(null);

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const [inFlightCount, setInFlightCount] = useState(0);
  const [errorBySource, setErrorBySource] = useState<SyncErrorBySource>({});

  const beginSync = useCallback(() => {
    setInFlightCount((n) => n + 1);
  }, []);

  const endSync = useCallback((errors?: SyncErrorBySource) => {
    setInFlightCount((n) => Math.max(0, n - 1));
    if (errors) {
      setErrorBySource((prev) => {
        const next: SyncErrorBySource = { ...prev };
        for (const k of ["notion", "todoist", "gcal"] as SourceKey[]) {
          if (errors[k] === undefined) continue;
          if (errors[k] === null || errors[k] === "") {
            delete next[k];
          } else {
            next[k] = errors[k]!;
          }
        }
        return next;
      });
    }
  }, []);

  const clearError = useCallback((source: SourceKey) => {
    setErrorBySource((prev) => {
      if (!(source in prev)) return prev;
      const next = { ...prev };
      delete next[source];
      return next;
    });
  }, []);

  const value = useMemo<SyncStatusValue>(
    () => ({
      inFlight: inFlightCount > 0,
      errorBySource,
      beginSync,
      endSync,
      clearError,
    }),
    [inFlightCount, errorBySource, beginSync, endSync, clearError],
  );

  return <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>;
}

export function useSyncStatus(): SyncStatusValue {
  const ctx = useContext(SyncStatusContext);
  if (!ctx) {
    return {
      inFlight: false,
      errorBySource: {},
      beginSync: () => {},
      endSync: () => {},
      clearError: () => {},
    };
  }
  return ctx;
}
