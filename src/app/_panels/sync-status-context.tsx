"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SourceKey } from "@/lib/dashboard-data";

type SyncErrorBySource = Partial<Record<SourceKey, string>>;
type SyncRetryBySource = Partial<Record<SourceKey, boolean>>;

type SyncProviderResult = { ok?: boolean; error?: string };
type SyncRunResponse = {
  ok?: boolean;
  error?: string;
  notion?: SyncProviderResult;
  todoist?: SyncProviderResult;
  gcal?: SyncProviderResult;
};

type SyncStatusValue = {
  inFlight: boolean;
  errorBySource: SyncErrorBySource;
  retryingBySource: SyncRetryBySource;
  beginSync: () => void;
  endSync: (errors?: SyncErrorBySource) => void;
  clearError: (source: SourceKey) => void;
  retrySource: (source: SourceKey) => Promise<void>;
};

const SyncStatusContext = createContext<SyncStatusValue | null>(null);

const ALL_SOURCES: SourceKey[] = ["notion", "todoist", "gcal"];

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [inFlightCount, setInFlightCount] = useState(0);
  const [errorBySource, setErrorBySource] = useState<SyncErrorBySource>({});
  const [retryingBySource, setRetryingBySource] = useState<SyncRetryBySource>({});

  const beginSync = useCallback(() => {
    setInFlightCount((n) => n + 1);
  }, []);

  const endSync = useCallback((errors?: SyncErrorBySource) => {
    setInFlightCount((n) => Math.max(0, n - 1));
    if (errors) {
      setErrorBySource((prev) => {
        const next: SyncErrorBySource = { ...prev };
        for (const k of ALL_SOURCES) {
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

  const retrySource = useCallback(
    async (source: SourceKey) => {
      setRetryingBySource((prev) => ({ ...prev, [source]: true }));
      setInFlightCount((n) => n + 1);
      try {
        const res = await fetch("/api/sync/run", { method: "POST" });
        const body = (await res.json().catch(() => ({}))) as SyncRunResponse;
        const nextErrors: SyncErrorBySource = {
          notion:
            body.notion?.ok === false
              ? body.notion.error ?? "Notion sync failed"
              : "",
          todoist:
            body.todoist?.ok === false
              ? body.todoist.error ?? "Todoist sync failed"
              : "",
          gcal:
            body.gcal?.ok === false
              ? body.gcal.error ?? "Calendar sync failed"
              : "",
        };
        setErrorBySource((prev) => {
          const next: SyncErrorBySource = { ...prev };
          for (const k of ALL_SOURCES) {
            if (nextErrors[k] === "") {
              delete next[k];
            } else if (nextErrors[k]) {
              next[k] = nextErrors[k]!;
            }
          }
          return next;
        });
        router.refresh();
      } catch (e) {
        setErrorBySource((prev) => ({
          ...prev,
          [source]: (e as Error)?.message ?? "Network error",
        }));
      } finally {
        setRetryingBySource((prev) => {
          const next = { ...prev };
          delete next[source];
          return next;
        });
        setInFlightCount((n) => Math.max(0, n - 1));
      }
    },
    [router],
  );

  const value = useMemo<SyncStatusValue>(
    () => ({
      inFlight: inFlightCount > 0,
      errorBySource,
      retryingBySource,
      beginSync,
      endSync,
      clearError,
      retrySource,
    }),
    [
      inFlightCount,
      errorBySource,
      retryingBySource,
      beginSync,
      endSync,
      clearError,
      retrySource,
    ],
  );

  return <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>;
}

export function useSyncStatus(): SyncStatusValue {
  const ctx = useContext(SyncStatusContext);
  if (!ctx) {
    return {
      inFlight: false,
      errorBySource: {},
      retryingBySource: {},
      beginSync: () => {},
      endSync: () => {},
      clearError: () => {},
      retrySource: async () => {},
    };
  }
  return ctx;
}
