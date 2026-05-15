"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { useSyncStatus } from "./sync-status-context";

const AUTO_SYNC_INTERVAL_MS = 30_000;

type TodoistAutoSyncResponse = {
  ok?: boolean;
  changed?: boolean;
  error?: string;
};

type GcalAutoSyncResponse = {
  ok?: boolean;
  changed?: boolean;
  error?: string;
};

export function AutoTodoistSync() {
  const router = useRouter();
  const { beginSync, endSync } = useSyncStatus();
  const inFlight = useRef(false);

  const run = useCallback(async () => {
    if (inFlight.current || document.visibilityState !== "visible") return;
    inFlight.current = true;
    beginSync();
    try {
      const [todoistRes, gcalRes] = await Promise.all([
        fetch("/api/sync/todoist", {
          method: "POST",
          cache: "no-store",
        }),
        fetch("/api/sync/gcal", {
          method: "POST",
          cache: "no-store",
        }),
      ]);
      if (todoistRes.status === 401 || gcalRes.status === 401) {
        endSync();
        return;
      }
      const todoistBody = (await todoistRes.json().catch(() => ({}))) as TodoistAutoSyncResponse;
      const gcalBody = (await gcalRes.json().catch(() => ({}))) as GcalAutoSyncResponse;
      const todoistOk = todoistRes.ok && todoistBody.ok !== false;
      const gcalOk = gcalRes.ok && gcalBody.ok !== false;
      endSync({
        todoist: todoistOk ? "" : todoistBody.error ?? `HTTP ${todoistRes.status}`,
        gcal: gcalOk ? "" : gcalBody.error ?? `HTTP ${gcalRes.status}`,
      });
      if (
        (todoistOk && todoistBody.changed) ||
        (gcalOk && gcalBody.changed)
      ) {
        router.refresh();
      }
    } catch {
      endSync();
    } finally {
      inFlight.current = false;
    }
  }, [router, beginSync, endSync]);

  useEffect(() => {
    void run();

    const interval = window.setInterval(() => void run(), AUTO_SYNC_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void run();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [run]);

  return null;
}
