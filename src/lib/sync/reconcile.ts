/**
 * Reconcile: bring Notion and Todoist to the same state, in four passes.
 *
 * Historically this file was only the drift scan — walk every `task_links` row,
 * recompute the pair's hash, mirror whichever side moved. That pass exists
 * because webhook handlers do their work in `Promise.resolve().then(...)`
 * *after* sending 200, which Vercel can terminate when a function instance
 * shuts down; a webhook can be acknowledged but never applied, and the only
 * place to notice is here, on a daily cron or on demand from the button.
 *
 * A link scan structurally cannot see a task that has no link — which is every
 * task typed into one app and never carried to the other. Three more passes
 * cover that, and together they are what makes the button's promise true:
 *
 *   1. `adoptExactTitleMatches` — link the rows that were plainly already
 *      pairs, so the create passes below don't make a second copy of them.
 *   2. the drift scan — repair the pairs that exist, adopted ones included.
 *   3. `createMissingTodoistMirrors` — Notion sub-tasks with no Todoist side.
 *   4. `createMissingNotionMirrors` — Todoist tasks with no Notion side.
 *
 * All four read the cached copies in Postgres, so the run starts by refreshing
 * that cache from both APIs. Without it "everything matches" would only ever
 * mean "everything matched whenever the last webhook landed".
 */

import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import { mapBoundedConcurrent } from "@/lib/sync/concurrency";
import { adoptExactTitleMatches, type LinkAdoptionSummary } from "@/lib/sync/link-adoption";
import {
  createMissingTodoistMirrors,
  type MirrorBackfillSummary,
} from "@/lib/sync/mirror-backfill";
import {
  createMissingNotionMirrors,
  type NotionBackfillSummary,
} from "@/lib/sync/notion-backfill";
import { syncNotion } from "@/lib/sync/notion";
import { hashForPair, mirrorNotionFromTodoist, mirrorTodoistFromNotion } from "@/lib/sync/orchestrator";
import { syncTodoist } from "@/lib/sync/todoist";
import { reconcileTodoistSyncResult } from "@/lib/sync/todoist-reconcile";
import type { NotionPage, TodoistTask } from "@/lib/sync/mappings";

const STALE_PENDING_MS = 10 * 60 * 1000;
const RECONCILE_CONCURRENCY = 5;

export type RefreshSummary = {
  notionError: string | null;
  todoistError: string | null;
  /** Todoist-side changes the pull observed and mirrored into Notion. */
  mirroredFromTodoist: number;
  /** Recurring links repointed at the next open instance. */
  recurringRepaired: number;
};

export type ReconcileSummary = {
  scanned: number;
  inSync: number;
  mirroredToTodoist: number;
  mirroredToNotion: number;
  closedArchived: number;
  staleCleared: number;
  missingRows: number;
  errors: { linkId: string; error: string }[];
  /** Pull of both sources that the four passes then compare. */
  refresh: RefreshSummary;
  /** Unlinked rows on both sides that were plainly the same task. */
  adopted: LinkAdoptionSummary;
  /** Notion tasks that had no Todoist counterpart to scan. */
  backfill: MirrorBackfillSummary;
  /** Todoist tasks that had no Notion counterpart to scan. */
  notionBackfill: NotionBackfillSummary;
};

export async function reconcileAllLinks(): Promise<ReconcileSummary> {
  const refresh = await refreshBothSources();

  // Adoption first, and it is cheap — no API calls, just `task_links` rows for
  // pairs that already exist in both apps. Doing it here means the drift scan
  // repairs them in the same run and neither create pass duplicates them.
  const adopted = await adoptExactTitleMatches();

  // Then drift: repairing pairs that already exist shouldn't have to share the
  // function's time budget with task creation.
  const drift = await scanTaskLinks();

  const summary: ReconcileSummary = {
    ...drift,
    refresh,
    adopted,
    backfill: await createMissingTodoistMirrors(),
    notionBackfill: await createMissingNotionMirrors(),
  };

  await logAudit({
    source: "reconcile",
    op: "reconcile_run",
    payload: summary as unknown as Record<string, unknown>,
  });

  return summary;
}

/**
 * Pull both sources into the cache before comparing them.
 *
 * A failure on one side is reported, not thrown: reconciling against a cache
 * that is a few minutes stale still repairs plenty, and refusing to run at all
 * because Notion returned a 502 would make the button useless exactly when
 * something is already wrong. The mirroring passes hit the live APIs anyway, so
 * a write against a stale row still fails loudly rather than silently landing.
 *
 * The Todoist result has to be handed to `reconcileTodoistSyncResult`, the same
 * way `/api/sync/run` does, and it is not optional here. `syncTodoist` reports
 * a change exactly once — the upsert's `RETURNING` is what names the changed
 * rows, so the next pull sees nothing to report. Dropping the result would
 * therefore *consume* a completed recurring task's signal: the drift scan finds
 * the old id gone from Todoist and counts a missing row, and the link is never
 * repointed at the new instance.
 */
async function refreshBothSources(): Promise<RefreshSummary> {
  const [notion, todoist] = await Promise.allSettled([syncNotion(), syncTodoist()]);

  const refresh: RefreshSummary = {
    notionError: notion.status === "rejected" ? errorMessage(notion.reason) : null,
    todoistError: todoist.status === "rejected" ? errorMessage(todoist.reason) : null,
    mirroredFromTodoist: 0,
    recurringRepaired: 0,
  };

  if (todoist.status === "fulfilled") {
    const applied = await reconcileTodoistSyncResult(todoist.value, "reconcile-refresh");
    refresh.mirroredFromTodoist = applied.mirrored;
    refresh.recurringRepaired = applied.repaired;
  }

  if (refresh.notionError || refresh.todoistError) {
    await logAudit({
      source: "reconcile",
      op: "reconcile_refresh_error",
      payload: refresh as unknown as Record<string, unknown>,
      error: refresh.notionError ?? refresh.todoistError,
    });
  }

  return refresh;
}

function errorMessage(reason: unknown): string {
  return String((reason as Error)?.message ?? reason);
}

type DriftSummary = Omit<
  ReconcileSummary,
  "refresh" | "adopted" | "backfill" | "notionBackfill"
>;

async function scanTaskLinks(): Promise<DriftSummary> {
  const summary: DriftSummary = {
    scanned: 0,
    inSync: 0,
    mirroredToTodoist: 0,
    mirroredToNotion: 0,
    closedArchived: 0,
    staleCleared: 0,
    missingRows: 0,
    errors: [],
  };

  const links = await db.select().from(schema.taskLinks);
  const now = Date.now();
  if (!links.length) return summary;

  // Batch-load both sides into Maps to avoid N+1 SELECTs in the loop.
  const notionPageIds = [...new Set(links.map((l) => l.notionPageId))];
  const todoistTaskIds = [...new Set(links.map((l) => l.todoistTaskId))];
  const [pages, tasks] = await Promise.all([
    db.select().from(schema.notionPages).where(inArray(schema.notionPages.id, notionPageIds)),
    db.select().from(schema.todoistTasks).where(inArray(schema.todoistTasks.id, todoistTaskIds)),
  ]);
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  await mapBoundedConcurrent(links, RECONCILE_CONCURRENCY, async (link) => {
    summary.scanned++;
    try {
      const page = pageById.get(link.notionPageId);
      const task = taskById.get(link.todoistTaskId);

      if (!page || !task) {
        summary.missingRows++;
        await logAudit({
          source: "reconcile",
          op: "reconcile_missing_row",
          payload: {
            linkId: link.id,
            notionPageId: link.notionPageId,
            todoistTaskId: link.todoistTaskId,
            hasPage: !!page,
            hasTask: !!task,
          },
        });
        return;
      }

      // Stale pending marker: an in-flight write that never cleaned up. Clear it and proceed.
      if (link.pendingOrigin != null && link.lastSyncAt.getTime() < now - STALE_PENDING_MS) {
        await db
          .update(schema.taskLinks)
          .set({ pendingOrigin: null })
          .where(eq(schema.taskLinks.id, link.id));
        summary.staleCleared++;
        await logAudit({
          source: "reconcile",
          op: "reconcile_cleared_stale_pending",
          payload: {
            linkId: link.id,
            staleFor: now - link.lastSyncAt.getTime(),
            pendingOrigin: link.pendingOrigin,
          },
        });
      } else if (link.pendingOrigin != null) {
        // A fresh in-flight write — leave it alone; the originating call will refresh the hash.
        return;
      }

      const p = page as NotionPage;
      const t = task as TodoistTask;
      const currentHash = hashForPair(p, t);

      if (currentHash === link.lastSyncHash && !p.archived && !p.ignore) {
        summary.inSync++;
        return;
      }

      // Archived/ignored Notion task with an open Todoist mirror — `mirrorTodoistFromNotion`
      // will close it. Drive in that direction regardless of timestamps.
      if ((p.archived || p.ignore) && !t.checked) {
        await mirrorTodoistFromNotion(link.notionPageId);
        summary.closedArchived++;
        return;
      }

      // Tie-break by the more recently touched side. Both `updatedAt` columns are bumped
      // by every upsert / API write, so newer side ≈ authoritative.
      const pageMs = page.updatedAt.getTime();
      const taskMs = task.updatedAt.getTime();
      if (pageMs >= taskMs) {
        await mirrorTodoistFromNotion(link.notionPageId);
        summary.mirroredToTodoist++;
      } else {
        await mirrorNotionFromTodoist(link.todoistTaskId);
        summary.mirroredToNotion++;
      }
    } catch (e) {
      const msg = (e as Error).message;
      summary.errors.push({ linkId: link.id, error: msg });
      await logAudit({
        source: "reconcile",
        op: "reconcile_error",
        payload: { linkId: link.id, notionPageId: link.notionPageId, todoistTaskId: link.todoistTaskId },
        error: msg,
      });
    }
  });

  return summary;
}
