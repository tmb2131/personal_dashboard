"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

const AUTO_SYNC_INTERVAL_MS = 30_000;

type TodoistAutoSyncResponse = {
  ok?: boolean;
  changed?: boolean;
};

export function AutoTodoistSync() {
  const router = useRouter();
  const inFlight = useRef(false);

  const run = useCallback(async () => {
    if (inFlight.current || document.visibilityState !== "visible") return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/sync/todoist", {
        method: "POST",
        cache: "no-store",
      });
      if (res.status === 401) return;
      const body = (await res.json().catch(() => ({}))) as TodoistAutoSyncResponse;
      if (res.ok && body.ok && body.changed) router.refresh();
    } finally {
      inFlight.current = false;
    }
  }, [router]);

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
