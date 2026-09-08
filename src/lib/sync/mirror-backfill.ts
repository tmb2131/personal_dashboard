/**
 * Create the Todoist side of Notion tasks that were never mirrored at all.
 *
 * Why this exists: every automatic Notion → Todoist path is link-aware, and a
 * task typed into Notion has no link yet. The webhook calls
 * `mirrorTodoistFromNotion`, which returns immediately when `task_links` has no
 * row; `reconcileAllLinks` walks `task_links` itself, so it never sees the page
 * either. The task therefore shows up on the dashboard — which reads the Notion
 * cache directly — while Todoist never hears about it, and the only cure was
 * running `scripts/push-notion-subtasks-to-notion-todoist-project.ts` by hand.
 * Reconcile now closes that gap on the same cadence it fixes drift.
 */

import { and, eq, isNotNull } from "drizzle-orm";
import { db, notionPageColumns, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import { mapBoundedConcurrent } from "@/lib/sync/concurrency";
import { pushNotionPageToTodoist } from "@/lib/sync/cross-post";
import { normalizeTitleForMatch } from "@/lib/sync/mappings";
import { selectMirrorCandidates } from "@/lib/sync/mirror-backfill-utils";
import { getInboxProjectId, getTodoistProjectIdByName } from "@/lib/sync/todoist";

/**
 * Where mirrored Notion tasks live in Todoist. Every mirror made so far sits in a
 * project called "Notion" — see
 * `scripts/push-notion-subtasks-to-notion-todoist-project.ts`, the manual version
 * of this pass — and that is worth keeping: the dashboard reads the Todoist inbox
 * as the "Personal" list, where a project's sub-tasks do not belong.
 *
 * The inbox is the fallback rather than the default, so a renamed or deleted
 * project degrades instead of throwing. Resolving a destination by name with no
 * fallback is what broke every Todoist write path when the "Personal" project was
 * deleted.
 */
const MIRROR_PROJECT_NAME = "Notion";

/**
 * Most tasks one run will create. The first run after this shipped has a whole
 * backlog behind it, and emptying it into Todoist in one go — on an API budget
 * shared with the drift pass, inside a 60s function — is worse than spreading it
 * over a few runs. `remaining` reports what is left so the UI can say so.
 */
export const MIRROR_BACKFILL_LIMIT = 25;

const CREATE_CONCURRENCY = 3;

/** Cap on how many rows an audit payload names, so one run can't write a novel. */
const AUDIT_SAMPLE = 40;

export type MirrorBackfillSummary = {
  /** Unlinked Notion sub-tasks that should have a Todoist mirror. */
  candidates: number;
  created: number;
  /** Held back because an unlinked Todoist task already carries the title. */
  skippedTitleMatch: number;
  /** Candidates left for the next run after the per-run cap. */
  remaining: number;
  /** Run-level failure (no token, no reachable project) — nothing was created. */
  error: string | null;
  errors: { notionPageId: string; title: string; error: string }[];
};

function emptySummary(): MirrorBackfillSummary {
  return {
    candidates: 0,
    created: 0,
    skippedTitleMatch: 0,
    remaining: 0,
    error: null,
    errors: [],
  };
}

export async function createMissingTodoistMirrors(): Promise<MirrorBackfillSummary> {
  const summary = emptySummary();

  if (!process.env.TODOIST_TOKEN) {
    summary.error = "TODOIST_TOKEN missing";
    await logAudit({
      source: "reconcile",
      op: "mirror_backfill_skipped",
      payload: { reason: summary.error },
    });
    return summary;
  }

  const [links, pages, openTasks] = await Promise.all([
    db
      .select({
        notionPageId: schema.taskLinks.notionPageId,
        todoistTaskId: schema.taskLinks.todoistTaskId,
      })
      .from(schema.taskLinks),
    db
      .select(notionPageColumns)
      .from(schema.notionPages)
      .where(
        and(
          isNotNull(schema.notionPages.parentId),
          eq(schema.notionPages.archived, false),
          eq(schema.notionPages.ignore, false),
        ),
      ),
    db
      .select({ id: schema.todoistTasks.id, content: schema.todoistTasks.content })
      .from(schema.todoistTasks)
      .where(eq(schema.todoistTasks.checked, false)),
  ]);

  const linkedNotionPageIds = new Set(links.map((l) => l.notionPageId));
  const linkedTodoistTaskIds = new Set(links.map((l) => l.todoistTaskId));
  const unlinkedTodoistTitles = new Set(
    openTasks
      .filter((t) => !linkedTodoistTaskIds.has(t.id))
      .map((t) => normalizeTitleForMatch(t.content)),
  );

  const selection = selectMirrorCandidates({
    pages,
    linkedNotionPageIds,
    unlinkedTodoistTitles,
    limit: MIRROR_BACKFILL_LIMIT,
  });

  summary.candidates =
    selection.create.length + selection.titleMatched.length + selection.remaining.length;
  summary.skippedTitleMatch = selection.titleMatched.length;
  summary.remaining = selection.remaining.length;

  if (selection.titleMatched.length) {
    // Worth naming: each one is either a link that went missing or a task the
    // user keeps in both apps by hand, and only they can tell which.
    await logAudit({
      source: "reconcile",
      op: "mirror_backfill_title_match_skipped",
      payload: {
        count: selection.titleMatched.length,
        pages: selection.titleMatched
          .slice(0, AUDIT_SAMPLE)
          .map((p) => ({ notionPageId: p.id, title: p.title })),
      },
    });
  }

  if (!selection.create.length) {
    await logAudit({
      source: "reconcile",
      op: "mirror_backfill",
      payload: summary as unknown as Record<string, unknown>,
    });
    return summary;
  }

  // Resolved once for the run: `pushNotionPageToTodoist` otherwise fetches the
  // whole project list per task just to find its destination.
  let destination: { id: string; name: string };
  try {
    destination = await resolveMirrorProjectId();
  } catch (e) {
    summary.error = (e as Error).message;
    await logAudit({
      source: "reconcile",
      op: "mirror_backfill_error",
      payload: { candidates: summary.candidates },
      error: summary.error,
    });
    return summary;
  }
  await logAudit({
    source: "reconcile",
    op: "mirror_backfill_destination",
    payload: {
      project: destination.name,
      projectId: destination.id,
      creating: selection.create.length,
    },
  });

  await mapBoundedConcurrent(selection.create, CREATE_CONCURRENCY, async (p) => {
    try {
      await pushNotionPageToTodoist(p.id, { todoistProjectId: destination.id });
      summary.created++;
      await logAudit({
        source: "reconcile",
        op: "mirror_backfill_created",
        payload: { notionPageId: p.id, title: p.title },
      });
    } catch (e) {
      const msg = (e as Error).message;
      summary.errors.push({ notionPageId: p.id, title: p.title, error: msg });
      await logAudit({
        source: "reconcile",
        op: "mirror_backfill_error",
        payload: { notionPageId: p.id, title: p.title },
        error: msg,
      });
    }
  });

  await logAudit({
    source: "reconcile",
    op: "mirror_backfill",
    payload: summary as unknown as Record<string, unknown>,
  });

  return summary;
}

/** The "Notion" project when it exists, the inbox when it doesn't. */
async function resolveMirrorProjectId(): Promise<{ id: string; name: string }> {
  try {
    return {
      id: await getTodoistProjectIdByName(MIRROR_PROJECT_NAME),
      name: MIRROR_PROJECT_NAME,
    };
  } catch {
    return { id: await getInboxProjectId(), name: "Inbox" };
  }
}
