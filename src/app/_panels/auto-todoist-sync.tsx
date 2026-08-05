"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { useSyncStatus } from "./sync-status-context";
import {
  FASTEST_RUNG,
  SLOWEST_RUNG,
  delayForRung,
  resumeDelayMs,
  slower,
} from "./sync-pace";

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
  /** Current position on the backoff ladder; see `./sync-pace`. */
  const rung = useRef(FASTEST_RUNG);
  const lastRunAt = useRef(0);

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
        // Signed out: nothing can change until the session comes back, and
        // retrying every 30s only keeps the compute awake to be told so again.
        rung.current = SLOWEST_RUNG;
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
      const changed =
        (todoistOk && todoistBody.changed) ||
        (gcalOk && gcalBody.changed) ||
        notionChanged;
      // Something moved, so more is probably coming — an edit on the phone
      // usually arrives as a burst. A quiet round backs off instead.
      rung.current = changed ? FASTEST_RUNG : slower(rung.current);
      if (changed) {
        router.refresh();
      }
    } catch (e) {
      // Recording nothing here left the source merely "stale" rather than
      // failed, which is how a hard sync outage stayed invisible: amber and
      // ageing, with no error text and no retry link.
      const message = e instanceof Error ? e.message : "Network error";
      endSync({ todoist: message, gcal: message, notion: message });
      // A failing backend is the last thing that wants a tight retry loop.
      rung.current = slower(rung.current);
    } finally {
      lastRunAt.current = Date.now();
      inFlight.current = false;
    }
  }, [router, beginSync, endSync, notionDataVersion]);

  // The loop reads `run` through a ref so it can mount once. Keying the effect
  // on `run` itself would tear the chain down and poll again on every
  // `router.refresh()`, which is exactly when a fresh poll is least useful.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    let timer = 0;
    let generation = 0;
    let stopped = false;

    /**
     * Every reschedule takes a new generation, so a tick still awaiting its
     * fetches when the user reappears finds itself stale and declines to queue
     * a second chain.
     */
    const schedule = (delayMs: number) => {
      const gen = (generation += 1);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void tick(gen), delayMs);
    };

    const tick = async (gen: number) => {
      await runRef.current();
      // A hidden tab stops rescheduling entirely rather than ticking through
      // no-op runs; `visibilitychange` starts it up again.
      if (stopped || gen !== generation || document.visibilityState !== "visible") {
        return;
      }
      schedule(delayForRung(rung.current));
    };

    const start = () => {
      const gen = (generation += 1);
      window.clearTimeout(timer);
      void tick(gen);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      // Coming back to the tab is the strongest "the user is here" signal there
      // is, and the data may well have moved while it was hidden.
      rung.current = FASTEST_RUNG;
      start();
    };

    /**
     * Touching the page resets the pace without firing a request of its own.
     * The guard means the reschedule happens once, on the first sign of life
     * after backing off; every later event is free.
     */
    const onActivity = () => {
      if (rung.current === FASTEST_RUNG) return;
      rung.current = FASTEST_RUNG;
      schedule(resumeDelayMs(lastRunAt.current, Date.now()));
    };

    start();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onActivity);
    document.addEventListener("pointerdown", onActivity);
    document.addEventListener("keydown", onActivity);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onActivity);
      document.removeEventListener("pointerdown", onActivity);
      document.removeEventListener("keydown", onActivity);
    };
  }, []);

  return null;
}
