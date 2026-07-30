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

type NotionVersionResponse = {
  ok?: boolean;
  version?: number | null;
  error?: string;
};

export function AutoTodoistSync({
  notionDataVersion = null,
}: {
  /**
   * Notion data version baked into the payload this tab is rendering. Notion is
   * never synced from the browser — it arrives by webhook — so the only way an
   * open tab notices those writes is a newer version coming back from the probe.
   */
  notionDataVersion?: number | null;
} = {}) {
  const router = useRouter();
  const { beginSync, endSync } = useSyncStatus();
  const inFlight = useRef(false);

  const run = useCallback(async () => {
    if (inFlight.current || document.visibilityState !== "visible") return;
    inFlight.current = true;
    beginSync();
    try {
      const [todoistRes, gcalRes, notionRes] = await Promise.all([
        fetch("/api/sync/todoist", {
          method: "POST",
          cache: "no-store",
        }),
        fetch("/api/sync/gcal", {
          method: "POST",
          cache: "no-store",
        }),
        fetch("/api/sync/notion-version", { cache: "no-store" }),
      ]);
      if (todoistRes.status === 401 || gcalRes.status === 401) {
        endSync();
        return;
      }
      const todoistBody = (await todoistRes.json().catch(() => ({}))) as TodoistAutoSyncResponse;
      const gcalBody = (await gcalRes.json().catch(() => ({}))) as GcalAutoSyncResponse;
      const notionBody = (await notionRes.json().catch(() => ({}))) as NotionVersionResponse;
      const todoistOk = todoistRes.ok && todoistBody.ok !== false;
      const gcalOk = gcalRes.ok && gcalBody.ok !== false;
      const notionOk = notionRes.ok && notionBody.ok !== false;
      endSync({
        todoist: todoistOk ? "" : todoistBody.error ?? `HTTP ${todoistRes.status}`,
        gcal: gcalOk ? "" : gcalBody.error ?? `HTTP ${gcalRes.status}`,
        notion: notionOk ? "" : notionBody.error ?? `HTTP ${notionRes.status}`,
      });
      // Strict `>` keeps this loop-free: the refreshed payload carries the newer
      // version, so the next probe compares equal.
      const notionChanged =
        notionOk &&
        typeof notionBody.version === "number" &&
        notionDataVersion != null &&
        notionBody.version > notionDataVersion;
      if (
        (todoistOk && todoistBody.changed) ||
        (gcalOk && gcalBody.changed) ||
        notionChanged
      ) {
        router.refresh();
      }
    } catch (e) {
      // Recording nothing here left the source merely "stale" rather than
      // failed, which is how a hard sync outage stayed invisible: amber and
      // ageing, with no error text and no retry link.
      const message = e instanceof Error ? e.message : "Network error";
      endSync({ todoist: message, gcal: message, notion: message });
    } finally {
      inFlight.current = false;
    }
  }, [router, beginSync, endSync, notionDataVersion]);

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
